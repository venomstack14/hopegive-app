const mongoose = require('mongoose');
require('dotenv').config();

const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI)
    .then(() => console.log('✅ Connected to MongoDB Cloud Database.'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// --- SCHEMAS ---
const userSchema = new mongoose.Schema({
    full_name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    mobile: String,
    password_hash: { type: String, required: true },
    role: { type: String, default: 'donor' },
    is_verified: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
});

const campaignSchema = new mongoose.Schema({
    title: String, category: String, description: String,
    applicant_name: String, applicant_email: String, mobile: String,
    monthly_income: Number, dependants: Number,
    requested_amount: Number, approved_amount: { type: Number, default: 0 },
    raised_amount: { type: Number, default: 0 }, need_score: { type: Number, default: 0 },
    status: { type: String, default: 'pending' },
    created_at: { type: Date, default: Date.now }
});

const donationSchema = new mongoose.Schema({
    campaign_id: String, user_id: String, amount: { type: Number, required: true },
    donor_name: String, anonymous: { type: Number, default: 0 },
    status: { type: String, default: 'pending' }, transaction_ref: String,
    created_at: { type: Date, default: Date.now }
});

const disbursementSchema = new mongoose.Schema({
    campaign_id: String, campaign_title: String, amount: Number,
    vendor_name: String, invoice_number: String, description: String,
    created_at: { type: Date, default: Date.now }
});

const auditLogSchema = new mongoose.Schema({
    entity_type: String, action: String, details: Object,
    created_at: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', userSchema);
const Campaign = mongoose.model('Campaign', campaignSchema);
const Donation = mongoose.model('Donation', donationSchema);
const Disbursement = mongoose.model('Disbursement', disbursementSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// Audit logging helper
const logAudit = async (type, action, details) => {
    try {
        await AuditLog.create({ entity_type: type, action, details });
    } catch (err) {
        console.error('Audit log failed', err);
    }
};

module.exports = { User, Campaign, Donation, Disbursement, AuditLog, logAudit };