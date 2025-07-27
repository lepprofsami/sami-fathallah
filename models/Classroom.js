// models/Classroom.js
const mongoose = require('mongoose');
const User = require('./User'); // Assurez-vous que le modèle User est correctement importé si pas déjà

// Schema for individual file entries within a Classroom
const fileSchema = new mongoose.Schema({
    fileName: { type: String, required: true }, // Original file name
    filePath: { type: String, required: true }, // Unique path on the server
    fileSize: { type: Number, required: true }, // Size in bytes
    fileMimeType: { type: String, required: true }, // MIME type of the file (e.g., 'application/pdf')
    uploadDate: { type: Date, default: Date.now, required: true },
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: {
        type: String,
        enum: ['exercise', 'homework', 'correction', 'general'],
        default: 'general',
        required: true
    },
    folder: {
        type: String,
        default: 'General',
        trim: true
    }
});

// --- MODIFICATION ICI : Schéma pour les messages de chat individuels ---
const messageSchema = new mongoose.Schema({
 sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String }, // Pour les messages texte classiques
    file: { // Nouveau champ pour les fichiers
        fileName: { type: String },
        filePath: { type: String }, // L'URL Cloudinary
        fileMimeType: { type: String },
        fileSize: { type: Number },
        publicId: { type: String } // Pour gérer le fichier sur Cloudinary
    },
    type: { type: String, enum: ['text', 'file'], default: 'text' }, // Indique si c'est un message texte ou un fichier
    timestamp: { type: Date, default: Date.now }
});
  
// ----------------------------------------------------------------------

// Main Classroom Schema
const classroomSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    classCode: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    students: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    messages: [messageSchema], // This references the messageSchema defined above
    files: [fileSchema] // This references the fileSchema defined above
}, {
    timestamps: true
});

module.exports = mongoose.model('Classroom', classroomSchema);