// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // Assurez-vous d'avoir bien installé bcryptjs (npm install bcryptjs)

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true, // Username must be unique
        trim: true,
        lowercase: true // Store usernames in lowercase for consistency
    },
    password: {
        type: String,
        required: true
    },

    role: {
        type: String,
        enum: ['teacher', 'student'],
        required: true
    },
    classroom: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom',
        required: function() { return this.role === 'student'; }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// --- HOOK DE PRE-SAUVEGARDE POUR HASHER LE MOT DE PASSE ---
UserSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        // --- AJOUT DE DÉBOGAGE : Avant hachage ---
        console.log('User.js - pre("save"): Mot de passe reçu (avant hachage):', this.password);
        console.log('User.js - pre("save"): Longueur du mot de passe (avant hachage):', this.password.length);
        // --- FIN AJOUT DÉBOGAGE ---

        this.password = await bcrypt.hash(this.password, 10);

        // --- AJOUT DE DÉBOGAGE : Après hachage ---
        console.log('User.js - pre("save"): Mot de passe haché (après hachage):', this.password);
        // --- FIN AJOUT DÉBOGAGE ---
    }
    next();
});

// --- MÉTHODE DE SCHÉMA POUR COMPARER LES MOTS DE PASSE ---
UserSchema.methods.comparePassword = async function(candidatePassword) {
    // --- AJOUT DE DÉBOGAGE : Lors de la comparaison ---
    console.log('User.js - comparePassword: Candidat (clair):', candidatePassword);
    console.log('User.js - comparePassword: Longueur Candidat (clair):', candidatePassword.length);
    console.log('User.js - comparePassword: Stocké (haché):', this.password);
    // --- FIN AJOUT DÉBOGAGE ---
    return await bcrypt.compare(candidatePassword, this.password);
};

// Exporte le modèle User
module.exports = mongoose.model('User', UserSchema);
