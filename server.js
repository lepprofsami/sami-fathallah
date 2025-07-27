const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const session = require('express-session');
const http = require('http');
const MongoStore = require('connect-mongo');
const path = require('path');
const socketIo = require('socket.io');
require('dotenv').config();

const helmet = require('helmet'); // Import helmet for security headers
const cloudinary = require('cloudinary').v2;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- Cloudinary Configuration ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

// --- MongoDB Connection ---
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/math_learning';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connexion à MongoDB réussie !'))
    .catch(err => console.error('Erreur de connexion à MongoDB :', err));

// --- Middleware Setup ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
    console.log('Server.js - req.body:', req.body);
    console.log('Server.js - req.method:', req.method);
    console.log('Server.js - req.url:', req.url);
    next();
});

// Configuration of EJS view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('io', io);

// Serve static files (CSS, client-side JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// --- Session Configuration with connect-mongo ---
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'your_secret_key', // IMPORTANT: Use a strong, random key in .env
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGODB_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60, // 14 days
        autoRemove: 'interval',
        autoRemoveInterval: 10 // In minutes. Removes expired sessions every 10 minutes
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
        secure: process.env.NODE_ENV === 'production', // Use true in production with HTTPS
        httpOnly: true // Prevents client-side JS from accessing the cookie
    }
});

app.use(sessionMiddleware);

// Attach Socket.IO to session (if you're doing this)
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- Middleware to make 'user' and flash messages available in all EJS views ---
// UPDATED: Now correctly sets and clears flash messages from session
app.use((req, res, next) => {
    res.locals.user = req.session.user;

    // Set flash messages from session to res.locals for EJS templates
    res.locals.error = req.session.error;
    res.locals.message = req.session.success;

    // Clear flash messages from session after they've been used in a render cycle
    // This is crucial so they don't persist across multiple page loads
    delete req.session.error;
    delete req.session.success;

    next();
});

// --- Helmet for Content Security Policy ---
// UPDATED: Added 'data:' to mediaSrc directive for base64 audio/video
app.use(
    helmet.contentSecurityPolicy({
        directives: {
            defaultSrc: ["'self'"],
                        frameSrc: ["'self'", "https://res.cloudinary.com"], // Allow framing from self and Cloudinary

            // *** FIX FOR FONT AWESOME STYLESHEET ***
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"], // ADDED cdnjs.cloudflare.com
            // If you have any scripts from cdnjs.cloudflare.com or other CDNs, add them here
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"], // ADDED cdnjs.cloudflare.com (for any potential scripts from there)
            imgSrc: ["'self'", "data:", "https://res.cloudinary.com","blob:"],
            // Ensure connectSrc matches your Socket.IO connection in production (e.g., wss://yourdomain.com)
connectSrc: [
    "'self'",
    "ws://localhost:5000",
    // Only include the production WebSocket URL if in production
    process.env.NODE_ENV === 'production' ? "wss://YOUR_PRODUCTION_DOMAIN.com" : ""
].filter(Boolean), // .filter(Boolean) removes empty strings if NODE_ENV isn't 'production'            // *** FIX FOR FONT AWESOME FONTS (icons are often fonts) ***
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"], // ADDED cdnjs.cloudflare.com
            mediaSrc: ["'self'", "data:"],
            // objectSrc: ["'none'"], // Good default
            // frameSrc: ["'self'"], // Consider adding trusted domains if you embed iframes
        },
    })
);

// --- Multer Configuration for Cloudinary upload ---
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file || !file.originalname) {
            console.error('Multer fileFilter: Fichier ou originalname manquant/null.', file);
            return cb(new Error('Fichier invalide ou nom de fichier manquant.'));
        }

        const allowedMimeTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
        const mimetype = allowedMimeTypes.test(file.mimetype);
        const extname = allowedMimeTypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Seuls les fichiers images (jpeg, jpg, png, gif), PDF, DOC et DOCX sont autorisés !'));
    }
});

// --- Import Models and Routes ---
const Classroom = require('./models/Classroom');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const classRoutes = require('./routes/classRoutes');

// --- Middleware to check authentication ---
function isLoggedIn(req, res, next) {
    if (req.session.user) {
        return next();
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    // Changed redirect to '/auth/login' to be consistent with auth route prefix
    req.session.error = 'Veuillez vous connecter pour accéder à cette page.';
    res.redirect('/auth/login');
}
// --- TEMPORARY DEBUGGING ROUTE ---
app.get('/debug-logout', (req, res) => {
    console.log('\n--- DEBUG LOGOUT ROUTE HIT ---');
    if (req.session) {
        req.session.destroy(err => {
            if (err) {
                console.error('DEBUG: Erreur lors de la destruction de la session:', err);
                return res.status(500).send('DEBUG: Erreur de déconnexion.');
            }
            res.clearCookie('connect.sid');
            console.log('DEBUG: Session détruite. Redirection vers /auth/login.');
            res.redirect('/auth/login?message=' + encodeURIComponent('DEBUG: Vous avez été déconnecté via la route de débogage.'));
        });
    } else {
        console.log('DEBUG: Tentative de déconnexion sans session active.');
        res.redirect('/auth/login');
    }
});
// --- END TEMPORARY DEBUGGING ROUTE ---
// --- General Routes ---
// CRITICAL FIX: Changed from app.use('/', authRoutes) to app.use('/auth', authRoutes)
// This makes the backend routing consistent with your frontend form action="/auth/register"
app.use('/auth', authRoutes);
app.use('/', dashboardRoutes);
app.use('/classes', classRoutes);

// --- API Route for file upload in CHAT to Cloudinary ---
app.post('/api/chat/upload-file', upload.single('file'), async (req, res) => {
    if (!req.file) {
        let message = 'Aucun fichier n\'a été uploadé.';
        if (req.fileFilterError) {
            message = req.fileFilterError.message;
        } else if (req.multerError && req.multerError.code === 'LIMIT_FILE_SIZE') {
            message = 'Le fichier est trop volumineux ! Max 10MB autorisé.';
        } else if (req.multerError) {
            message = req.multerError.message;
        }
        return res.status(400).json({ success: false, message: message });
    }

    try {
        const fileType = req.file.mimetype;
        let cloudinaryResourceType = 'auto';

        if (fileType.startsWith('image/')) {
            cloudinaryResourceType = 'image';
        } else if (fileType === 'application/pdf' || fileType.includes('application/msword') || fileType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
            cloudinaryResourceType = 'raw';
        }

        const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    resource_type: cloudinaryResourceType,
                    folder: 'chat_uploads'
                },
                (error, result) => {
                    if (error) {
                        return reject(error);
                    }
                    resolve(result);
                }
            );
            uploadStream.end(req.file.buffer);
        });

        const publicUrl = result.secure_url;
        res.json({ success: true, fileUrl: publicUrl, fileType: req.file.mimetype });
    } catch (error) {
        console.error('Erreur lors de l\'upload vers Cloudinary (chat) :', error);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de l\'upload du fichier.' });
    }
}, (error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'Fichier trop volumineux ! Max 10MB autorisé.' });
        }
        return res.status(400).json({ success: false, message: error.message });
    } else if (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
    next();
});

// --- NEW ROUTE: Class File Deposit (outside chat) for classes ---
app.post('/classes/:classId/files', isLoggedIn, upload.single('classFile'), async (req, res) => {
    try {
        const classId = req.params.classId;
        const file = req.file;
        const { category } = req.body;

        // --- Gestion des erreurs initiales (pour les requêtes AJAX) ---
        if (!file) {
            let errorMessage = 'Aucun fichier n\'a été sélectionné.';
            if (req.fileFilterError) {
                errorMessage = req.fileFilterError.message;
            } else if (req.multerError && req.multerError.code === 'LIMIT_FILE_SIZE') {
                errorMessage = 'Le fichier est trop volumineux ! Max 10MB autorisé.';
            } else if (req.multerError) {
                errorMessage = req.multerError.message;
            }
            return res.status(400).json({ success: false, message: errorMessage });
        }

        if (!category) {
            return res.status(400).json({ success: false, message: 'Veuillez sélectionner une catégorie pour le fichier.' });
        }

        const b64 = Buffer.from(file.buffer).toString('base64');
        let dataURI = 'data:' + file.mimetype + ';base64,' + b64;

        let classFileResourceType = 'auto';
        if (file.mimetype.startsWith('image/')) {
            classFileResourceType = 'image';
        } else if (file.mimetype === 'application/pdf' || file.mimetype.includes('application/msword') || file.mimetype.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
            classFileResourceType = 'raw';
        }

        const cloudinaryUploadResult = await cloudinary.uploader.upload(dataURI, {
            folder: `class_files/${classId}`,
            resource_type: classFileResourceType,
            // Assurez-vous que le public_id est bien formé si vous le générez manuellement
        });

        if (!cloudinaryUploadResult || !cloudinaryUploadResult.secure_url) {
            return res.status(500).json({ success: false, message: 'Échec de l\'upload vers Cloudinary.' });
        }

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

        const classroom = await Classroom.findById(classId);
        if (!classroom) {
            return res.status(404).json({ success: false, message: 'Classe introuvable.' });
        }

        classroom.files.push(newFile);
        await classroom.save();

        // --- NOUVEAU : ENVOYER UNE RÉPONSE JSON POUR LA REQUÊTE AJAX ! ---
        res.json({
            success: true,
            message: 'Fichier uploadé et enregistré avec succès !',
            fileData: { // Tu peux renvoyer des données supplémentaires si le client en a besoin
                fileName: newFile.fileName,
                filePath: newFile.filePath,
                fileMimeType: newFile.fileMimeType,
                fileSize: newFile.fileSize,
                publicId: newFile.publicId
            }
        });

        // --- IMPORTANT : ÉMETTRE LE MESSAGE SOCKET.IO ICI ! ---
        // C'est ce qui va faire apparaître le message dans le chat pour TOUS les clients (y compris celui qui a uploadé).
        const io = req.app.get('io'); // Récupère l'instance io stockée dans app.set('io', io);

        io.to(classId).emit('message', {
            senderId: req.session.user._id,
            senderUsername: req.session.user.username,
            content: newFile.fileName, // Le nom du fichier ou un message court
            type: 'file', // Indique que c'est un message de type fichier
            file: { // Assure-toi que cet objet correspond à ce que ton client attend pour afficher un fichier
                fileName: newFile.fileName,
                filePath: newFile.filePath,
                fileMimeType: newFile.fileMimeType,
                fileSize: newFile.fileSize,
                publicId: newFile.publicId
            },
            timestamp: new Date()
        });

    } catch (error) {
        console.error('Erreur CRITIQUE lors de l\'upload du fichier de classe (Dépôt) :', error);
        // En cas d'erreur, renvoie également une réponse JSON appropriée
        res.status(500).json({ success: false, message: 'Erreur lors de l\'upload du fichier : ' + error.message });
    }
});

// Main route (home)
app.get('/', (req, res) => {
    res.render('index', { title: 'Accueil - Math-learning' });
});

// Demo route to clear DB (DEV ONLY - REMOVE IN PRODUCTION)
app.get('/clear-db-dev-only', async (req, res) => {
    if (process.env.NODE_ENV !== 'production') {
        try {
            await mongoose.connection.dropCollection('users');
            await mongoose.connection.dropCollection('classrooms');
            await mongoose.connection.dropCollection('sessions');
            console.log('✅ Base de données (users, classrooms, sessions) vidée avec succès !');
            res.send('Base de données (users, classrooms, sessions) vidée avec succès !');
        } catch (error) {
            console.error('Erreur lors du vidage de la base de données :', error);
            res.status(500).send('Erreur lors du vidage de la base de données.');
        }
    } else {
        res.status(403).send('Accès interdit en production.');
    }
});

// --- Socket.IO connection logic ---
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, (err) => {
        if (err) {
            console.error('Erreur lors de l\'accès à la session Socket.IO:', err);
            return next(err);
        }
        next();
    });
});

// server.js

// ... (your existing imports and middleware setup) ...

io.on('connection', (socket) => {
    console.log('Un utilisateur s\'est connecté :', socket.id);

    const userInSession = socket.request.session.user;

    if (!userInSession) {
        console.log('Utilisateur non authentifié via session, déconnexion du socket.');
        return socket.disconnect(true);
    }

    socket.userId = userInSession._id;
    socket.username = userInSession.username;
    socket.userRole = userInSession.role;

    socket.on('joinRoom', (classroomId) => {
        socket.join(classroomId);
        console.log(`${socket.username} a rejoint la salle : ${classroomId}`);
    });

    // Modified chatMessage event to handle different message types
    // This handler primarily receives messages INITIATED FROM THE CLIENT (like text messages)
    // For file uploads, the route in classRoutes.js will emit directly.
    socket.on('chatMessage', async ({ classroomId, content, type, file }) => { // Expecting 'file' as an object
        const senderId = socket.userId;
        const senderUsername = socket.username;

        if (!senderId || !senderUsername) {
            console.error('Erreur: ID ou NOM D\'UTILISATEUR de l\'expéditeur manquant sur le socket.');
            return;
        }

        console.log(`Message reçu dans la classe ${classroomId} de ${senderUsername} (Type: ${type}):`, content || (file ? file.fileName : 'N/A'));

        try {
            const classroom = await Classroom.findById(classroomId);
            if (!classroom) {
                console.error('Classe non trouvée pour le message :', classroomId);
                return;
            }

            const newMessage = {
                sender: senderId,
                content: content,
                type: type || 'text', // Default to 'text' if not specified
                // Store the 'file' object if provided, otherwise it will be undefined/null
                file: file, // Store the entire file object as received
                timestamp: new Date()
            };

            classroom.messages.push(newMessage);
            await classroom.save();

            // Populate sender for emission if needed (though already available from socket)
            // If you want to ensure the _id is populated, you might do this:
            // await User.populate(newMessage, { path: 'sender', select: 'username' });

            // Emit the message to all clients in the classroom
            // Ensure the emitted payload matches what the client-side addMessageToChat function expects
            io.to(classroomId).emit('message', {
                senderId: senderId,
                senderUsername: senderUsername,
                content: content,
                type: type || 'text',
                file: file, // Emit the entire file object
                timestamp: newMessage.timestamp
            });

        } catch (error) {
            console.error('Erreur lors de l\'enregistrement ou de l\'envoi du message :', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Un utilisateur s\'est déconnecté :', socket.id);
    });
});

// --- Server Startup ---
// Using port 5000 as indicated by your error logs (http://localhost:5000)
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});