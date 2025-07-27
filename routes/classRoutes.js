const express = require('express');
const router = express.Router();
const Classroom = require('../models/Classroom');
const User = require('../models/User');

const isAuthenticated = require('../middleware/isAuthenticated');
const isClassMember = require('../middleware/isClassMember');

// NOUVEAUX IMPORTS POUR L'UPLOAD CLOUDINARY
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');

// --- Multer Configuration pour l'upload de fichiers de classe vers Cloudinary ---
const classFileUpload = multer({
    storage: multer.memoryStorage(), // Stocke le fichier en mémoire
    limits: { fileSize: 10 * 1024 * 1024 }, // Limite de taille de fichier à 10 MB
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = /^(image\/(jpeg|jpg|png|gif)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/;
        const allowedExtensions = /\.(jpeg|jpg|png|gif|pdf|doc|docx)$/i;

        const isMimeTypeAllowed = allowedMimeTypes.test(file.mimetype);
        const isExtNameAllowed = allowedExtensions.test(path.extname(file.originalname));

        if (isMimeTypeAllowed && isExtNameAllowed) {
            return cb(null, true);
        }
        req.fileFilterError = new Error('Seuls les fichiers images (jpeg, jpg, png, gif), PDF, DOC et DOCX sont autorisés !');
        cb(null, false);
    }
});
// --------------------------------------------------------------------------

// --- NOUVELLE ROUTE : POST / (pour créer une nouvelle classe) ---
router.post('/', isAuthenticated, async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'teacher') {
            console.warn(`Tentative de création de classe non autorisée par: ${req.session.user ? req.session.user.username : 'Utilisateur non connecté'}`);
            req.session.error = 'Accès interdit. Seuls les professeurs peuvent créer des classes.';
            return res.status(403).redirect('/teacher/dashboard');
        }

        const { name, classCode } = req.body;
        const teacherId = req.session.user._id;

        console.log('--- Tentative de Création de Classe ---');
        console.log(`Nom: ${name}, Code: ${classCode}, Professeur ID: ${teacherId}`);

        const existingClass = await Classroom.findOne({ classCode });
        if (existingClass) {
            console.warn(`Échec création classe: Code de classe '${classCode}' déjà utilisé.`);
            req.session.error = 'Un cours avec ce code existe déjà. Veuillez en choisir un autre.';
            return res.redirect('/teacher/dashboard');
        }

        const newClassroom = new Classroom({
            name,
            classCode,
            teacher: teacherId,
            students: [],
            messages: [],
            files: [],
        });

        await newClassroom.save();
        console.log(`Classe '${newClassroom.name}' créée avec succès. ID: ${newClassroom._id}`);

        await User.findByIdAndUpdate(teacherId, { $push: { classes: newClassroom._id } });
        console.log(`Classe ajoutée au profil du professeur: ${req.session.user.username}`);

        req.session.success = 'Cours créé avec succès !';
        res.redirect('/teacher/dashboard');

    } catch (error) {
        console.error('Erreur lors de la création de la classe :', error);
        let errorMessage = 'Erreur serveur lors de la création du cours.';
        if (error.name === 'ValidationError') {
            errorMessage = `Erreur de validation: ${error.message}`;
        }
        req.session.error = errorMessage;
        res.redirect('/teacher/dashboard');
    } finally {
        console.log('--- Fin Tentative de Création de Classe ---');
    }
});

// Get Class Details
router.get('/:id', isAuthenticated, isClassMember, async (req, res) => {
    try {
        const classroom = await Classroom.findById(req.params.id)
            .populate('teacher', 'username')
            .populate({
                path: 'messages',
                populate: {
                    path: 'sender',
                    select: 'username'
                }
            })
            .populate('students', 'username')
            .populate({
                path: 'files',
                populate: {
                    path: 'uploader',
                    select: 'username'
                }
            });

        if (!classroom) {
            console.warn(`Classroom with ID ${req.params.id} not found.`);
            req.session.error = 'Classe introuvable.';
            return res.status(404).redirect('/teacher/dashboard');
        }

        console.log('--- Classroom Object Sent to EJS ---');
        console.log(JSON.stringify(classroom, null, 2));
        console.log(`Number of messages: ${classroom.messages ? classroom.messages.length : 0}`);
        console.log(`Number of files: ${classroom.files ? classroom.files.length : 0}`);
        if (classroom.messages && classroom.messages.length > 0) {
            console.log('First message details:');
            console.log(`  Sender: ${classroom.messages[0].sender ? classroom.messages[0].sender.username : 'N/A'}`);
            console.log(`  Content: ${classroom.messages[0].content}`);
            console.log(`  Timestamp: ${classroom.messages[0].timestamp}`);
        }
        console.log('------------------------------------');

        res.render('class_details', {
            classroom,
            user: req.session.user,
            success: req.session.success,
            error: req.session.error
        });
        delete req.session.success;
        delete req.session.error;

    } catch (error) {
        console.error("Error retrieving class details:", error);
        req.session.error = 'Erreur serveur lors de l\'accès aux détails de la classe.';
        res.status(500).redirect('/teacher/dashboard');
    }
});

// Create a new message in the classroom chat (consider Socket.IO for real-time)
router.post('/:id/messages', isAuthenticated, isClassMember, async (req, res) => {
    try {
        const { content } = req.body;
        const classroom = await Classroom.findById(req.params.id);

        if (!classroom) {
            return res.status(404).json({ message: 'Classe introuvable.' });
        }

        const newMessage = {
            sender: req.session.user._id,
            content: content,
            type: 'text',
            timestamp: new Date()
        };

        classroom.messages.push(newMessage);
        await classroom.save();

        const savedMessage = classroom.messages[classroom.messages.length - 1];
        await User.populate(savedMessage, { path: 'sender', select: 'username' });

        if (req.app.get('io')) {
            req.app.get('io').to(req.params.id).emit('message', {
                senderId: savedMessage.sender._id,
                senderUsername: savedMessage.sender.username,
                content: savedMessage.content,
                type: savedMessage.type,
                timestamp: savedMessage.timestamp
            });
        } else {
            console.warn("Socket.IO instance not available in classRoutes for message emission.");
        }

        res.status(201).json({ message: 'Message envoyé.' });
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ message: 'Erreur serveur lors de l\'envoi du message.' });
    }
});

// Upload a file to the classroom
router.post('/:id/files', isAuthenticated, isClassMember, classFileUpload.single('classFile'), async (req, res) => {
    try {
        const classId = req.params.id;
        const classroom = await Classroom.findById(classId);
        const file = req.file;

        if (!classroom) {
            req.session.error = 'Classe introuvable.';
            return res.redirect(`/classes/${classId}`);
        }

        // Gérer les erreurs de Multer (fichier non sélectionné, trop gros, type non autorisé)
        if (req.fileFilterError) {
            req.session.error = req.fileFilterError.message;
            return res.redirect(`/classes/${classId}`);
        }
        if (!file) { // If no file was uploaded (e.g., no selection)
            req.session.error = 'Aucun fichier n\'a été sélectionné pour l\'upload.';
            return res.redirect(`/classes/${classId}`);
        }

        const { category } = req.body;
        const allowedCategories = ['exercise', 'homework', 'correction', 'general'];
        if (!category || !allowedCategories.includes(category)) {
            req.session.error = 'Catégorie de fichier invalide. Choisissez parmi Exercice, Devoir, Correction, Général.';
            return res.redirect(`/classes/${classId}`);
        }

        // --- Log pour diagnostic ---
        console.log('--- Démarrage du processus d\'upload de fichier de classe ---');
        console.log('1. Objet req.file reçu par Multer:', file);
        if (file && file.buffer) {
            console.log('   -> Multer a stocké le fichier en mémoire (buffer existe). Taille:', file.buffer.length, 'octets.');
        } else {
            console.log('   -> req.file.buffer est inattendu ou vide.');
        }
        console.log('Original Name:', file.originalname);
        console.log('MIME Type Multer:', file.mimetype);
        // --- FIN LOGS ---

        // Préparation du Data URI
        const b64 = Buffer.from(file.buffer).toString('base64');
        const dataURI = `data:${file.mimetype};base64,${b64}`;

        // ========================================================================
        // === CORRECTIONS IMPORTANTES ICI ===
        // ========================================================================

        // 1. Obtenez le nom de fichier original
        const originalFileName = file.originalname;

        // 2. Nettoyez le nom de fichier pour qu'il soit un public_id valide
        const cleanedFileName = originalFileName.replace(/\s+/g, '-').replace(/[^\w.-]/g, '');

        // 3. Créez le public_id complet avec le dossier et le nom de fichier nettoyé
        const fullPublicId = `class_files/${classId}/${cleanedFileName}`;

        // Logique pour déterminer le resource_type (déplacée ici pour être unique et claire)
        let effectiveResourceType = 'auto';
        if (file.mimetype.startsWith('image/')) {
            effectiveResourceType = 'image';
        } else if (file.mimetype.startsWith('video/')) {
            effectiveResourceType = 'video';
        } else if (file.mimetype.startsWith('audio/')) {
            effectiveResourceType = 'audio';
        } else if (file.mimetype === 'application/pdf' || file.mimetype.includes('application/msword') || file.mimetype.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
            effectiveResourceType = 'raw';
        }

        console.log('2. Tentative d\'upload vers Cloudinary...');
        console.log('DEBUG DataURI (début):', dataURI.substring(0, 50) + '...');
        console.log('DEBUG public_id utilisé:', fullPublicId); // Nouveau log

        const cloudinaryUploadResult = await cloudinary.uploader.upload(dataURI, {
            public_id: fullPublicId, // <--- MAINTENANT ON UTILISE CELA !
            resource_type: effectiveResourceType,
            overwrite: true // Optional: to replace an existing file with the same name
        });

        // ========================================================================
        // === FIN DES CORRECTIONS IMPORTANTES ===
        // ========================================================================

        // --- Logs pour diagnostic ---
        console.log('3. Résultat de l\'upload Cloudinary:', cloudinaryUploadResult);
        if (cloudinaryUploadResult && cloudinaryUploadResult.secure_url) {
            console.log('   -> URL sécurisée Cloudinary reçue:', cloudinaryUploadResult.secure_url);
        } else {
            console.error('   -> ERREUR: Cloudinary secure_url manquante ou upload échoué !');
            req.session.error = 'Erreur: Cloudinary n\'a pas retourné d\'URL pour le fichier.';
            return res.redirect(`/classes/${classId}`);
        }
        // --- FIN NOUVEAUX LOGS ---

        const fileUrl = cloudinaryUploadResult.secure_url;
        const publicId = cloudinaryUploadResult.public_id;

        const newFile = {
            fileName: file.originalname,
            filePath: fileUrl,
            fileSize: file.size,
            fileMimeType: file.mimetype,
            uploadDate: new Date(),
            uploader: req.session.user._id,
            category: category,
            publicId: publicId
        };

        console.log('4. Objet newFile prêt à être sauvegardé :', newFile);

        classroom.files.push(newFile);
        await classroom.save();

       const fileMessage = {
            sender: req.session.user._id,
            file: {
                fileName: newFile.fileName,
                filePath: newFile.filePath,
                fileMimeType: newFile.fileMimeType,
                fileSize: newFile.fileSize,
                publicId: newFile.publicId
            },
            type: 'file', // Définir le type comme 'file'
            timestamp: new Date()
        };

        classroom.messages.push(fileMessage); // Ajouter le message fichier au tableau de messages
        await classroom.save(); // Sauvegarder la classe avec le nouveau message

        // IMPORTANT: Émettre le message fichier via Socket.IO
        // Ceci est similaire à comment vous émettez les messages texte
        if (req.app.get('io')) {
            // Peupler le sender du message pour l'émission Socket.IO
            await User.populate(fileMessage, { path: 'sender', select: 'username' });

            req.app.get('io').to(classId).emit('message', {
                senderId: fileMessage.sender._id,
                senderUsername: fileMessage.sender.username,
                content: fileMessage.content, // Sera undefined pour les fichiers, c'est normal
                file: {
                    fileName: fileMessage.file.fileName,
                    filePath: fileMessage.file.filePath,
                    fileMimeType: fileMessage.file.fileMimeType,
                    fileSize: fileMessage.file.fileSize,
                    publicId: fileMessage.file.publicId
                },
                type: 'file', // Confirmer le type
                timestamp: fileMessage.timestamp
            });
        } else {
            console.warn("Socket.IO instance not available in classRoutes for file message emission.");
        }

        req.session.success = 'Fichier uploadé et enregistré avec succès !';
        res.redirect(`/classes/${classId}`);
    } catch (error) {
        console.error('Erreur CRITIQUE lors de l\'upload du fichier de classe (Dépôt) :', error);
        let errorMessage = 'Erreur serveur lors de l\'upload du fichier.';

        // 1. Gérer l'erreur spécifique du fileFilter de Multer que nous avons attachée
        if (req.fileFilterError) {
            errorMessage = req.fileFilterError.message;
        }
        // 2. Gérer les erreurs standard de Multer
        else if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                errorMessage = 'Le fichier est trop volumineux (max 10MB) !';
            }
            // Multer doesn't throw 'FILE_MISSING_OR_EMPTY' here. The !file check handles it.
        }
        // 3. Gérer les erreurs génériques (autres erreurs du try/catch)
        else {
            errorMessage = 'Une erreur inattendue est survenue lors du traitement du fichier : ' + error.message;
        }

        req.session.error = errorMessage;
        res.redirect(`/classes/${req.params.id}`);
    }
});

module.exports = router;