require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { User, Campaign, Donation, Disbursement, AuditLog, logAudit } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

app.use(cors());
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

// 👑 AUTO-CREATE SUPER ADMIN
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.ADMIN_PASS;

const initAdmin = async () => {
    if (ADMIN_EMAIL && ADMIN_PASS) {
        try {
            const user = await User.findOne({ email: ADMIN_EMAIL });
            if (!user) {
                const hash = bcrypt.hashSync(ADMIN_PASS, 10);
                await User.create({ full_name: 'System Admin', email: ADMIN_EMAIL, password_hash: hash, role: 'admin', is_verified: 1 });
                console.log(`\n👑 SUPER ADMIN CHECK PASSED!\n➡ Email: ${ADMIN_EMAIL}\n➡ Loaded securely via hidden cloud environment context.\n`);
            }
        } catch (err) {
            console.error('Error creating admin account:', err.message);
        }
    }
};
setTimeout(initAdmin, 4000); // Wait 4 seconds for MongoDB connection to establish first

// Middlewares
const authenticate = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied.' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Session expired.' });
        req.user = user;
        next();
    });
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
    next();
};

// ==========================================
// 1. AUTHENTICATION ROUTES
// ==========================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { full_name, email, mobile, password, role } = req.body;
        const hash = bcrypt.hashSync(password, 10);
        const safeRole = role === 'applicant' ? 'applicant' : 'donor';

        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ error: 'Email already exists' });

        const newUser = await User.create({ full_name, email, mobile, password_hash: hash, role: safeRole });
        const token = jwt.sign({ id: newUser._id, email, name: full_name, role: safeRole }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user_id: newUser._id, id: newUser._id, name: full_name, role: safeRole });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user._id, email: user.email, name: user.full_name, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user_id: user._id, id: user._id, name: user.full_name, role: user.role });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/logout', (req, res) => res.json({ message: 'Logged out' }));

// ==========================================
// 2. PUBLIC & STATS ROUTES
// ==========================================
app.get('/api/stats', async (req, res) => {
    try {
        const completedDons = await Donation.find({ status: 'completed' });
        const total_raised = completedDons.reduce((acc, d) => acc + d.amount, 0);
        const uniqueDonors = new Set(completedDons.map(d => d.user_id)).size;
        const beneficiaries = await Campaign.countDocuments({ status: 'active' });

        res.json({ total_raised, donors: uniqueDonors, beneficiaries });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/disbursements', async (req, res) => {
    const rows = await Disbursement.find().sort({ created_at: -1 });
    res.json(rows.map(r => ({ ...r.toObject(), id: r._id })));
});

// ==========================================
// 3. CAMPAIGNS (PUBLIC)
// ==========================================
app.get('/api/campaigns', async (req, res) => {
    try {
        const { status, category } = req.query;
        let query = { status: status || 'active' };
        if (category && category !== 'all') query.category = category;

        const rows = await Campaign.find(query);
        res.json(rows.map(r => ({ ...r.toObject(), id: r._id })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/campaigns/:id', async (req, res) => {
    try {
        const campaign = await Campaign.findById(req.params.id);
        if (!campaign) return res.status(404).json({ error: 'Not found' });
        
        const disbs = await Disbursement.find({ campaign_id: req.params.id });
        const result = campaign.toObject();
        result.id = campaign._id;
        result.disbursements = disbs.map(d => ({ ...d.toObject(), id: d._id }));
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/campaigns/:id/donors', async (req, res) => {
    const rows = await Donation.find({ campaign_id: req.params.id, status: 'completed' }).sort({ created_at: -1 });
    res.json(rows);
});

// ==========================================
// 4. APPLY FOR AID (PROTECTED)
// ==========================================
app.post('/api/campaigns', authenticate, upload.any(), async (req, res) => {
    try {
        const { title, category, description, monthly_income, dependants, requested_amount } = req.body;
        let score = 50 + (parseInt(dependants) * 5) - (parseFloat(monthly_income) / 1000);
        score = Math.min(Math.max(Math.round(score), 10), 100);

        const camp = await Campaign.create({
            title, category, description, applicant_name: req.user.name, applicant_email: req.user.email,
            monthly_income, dependants, requested_amount, need_score: score, status: 'pending'
        });

        await logAudit('Campaign', 'Submitted Application', { id: camp._id, title });
        res.json({ message: 'Submitted', campaign_id: camp._id, id: camp._id, need_score: score });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/campaigns/:id/flag', authenticate, async (req, res) => {
    await logAudit('Campaign', 'Flagged', { campaign_id: req.params.id, user_id: req.user.id, reason: req.body.reason });
    res.json({ message: 'Campaign flagged for review.' });
});

// ==========================================
// 5. DONATIONS
// ==========================================
app.post('/api/donations/initiate', async (req, res) => {
    try {
        const { campaign_id, amount, donor_name, anonymous, user_id } = req.body;
        const ref = 'HG-' + Math.floor(100000 + Math.random() * 900000);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        const don = await Donation.create({ campaign_id, user_id, amount, donor_name, anonymous, status: 'pending', transaction_ref: ref });
        res.json({ donation_id: don._id, id: don._id, demo_otp: otp, transaction_ref: ref });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/donations/:id/verify-otp', async (req, res) => {
    try {
        const donation = await Donation.findById(req.params.id);
        if (!donation) return res.status(404).json({ error: 'Not found' });

        donation.status = 'completed';
        await donation.save();

        await Campaign.findByIdAndUpdate(donation.campaign_id, { $inc: { raised_amount: donation.amount } });
        res.json({ message: 'Success', amount: donation.amount, transaction_ref: donation.transaction_ref });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 6. ADMIN ROUTES
// ==========================================
app.get('/api/admin/stats', authenticate, isAdmin, async (req, res) => {
    const completedDons = await Donation.find({ status: 'completed' });
    const total_raised = completedDons.reduce((acc, d) => acc + d.amount, 0);

    const disbs = await Disbursement.find();
    const total_disbursed = disbs.reduce((acc, d) => acc + d.amount, 0);

    const pending_campaigns = await Campaign.countDocuments({ status: 'pending' });

    res.json({ total_raised, total_disbursed, pending_campaigns, recent_flags: 0 });
});

app.get('/api/admin/campaigns', authenticate, isAdmin, async (req, res) => {
    const rows = await Campaign.find({ status: req.query.status || 'pending' });
    res.json(rows.map(r => ({ ...r.toObject(), id: r._id })));
});

app.post('/api/admin/campaigns/:id/review', authenticate, isAdmin, async (req, res) => {
    const { action, approved_amount, need_score, reason } = req.body;
    const status = action === 'approve' ? 'active' : 'rejected';

    await Campaign.findByIdAndUpdate(req.params.id, { status, approved_amount: approved_amount || 0, need_score: need_score || 0 });
    await logAudit('Campaign', action.toUpperCase(), { id: req.params.id, reason });
    res.json({ message: `Campaign ${status}` });
});

app.get('/api/admin/users', authenticate, isAdmin, async (req, res) => {
    const rows = await User.find({}, '-password_hash');
    res.json(rows.map(r => ({ ...r.toObject(), id: r._id })));
});

app.post('/api/admin/users/:id/verify', authenticate, isAdmin, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { is_verified: 1 });
    await logAudit('User', 'VERIFIED', { user_id: req.params.id });
    res.json({ message: 'User verified successfully' });
});

app.post('/api/admin/disbursements', authenticate, isAdmin, async (req, res) => {
    const { campaign_id, amount, vendor_name, invoice_number, description } = req.body;
    const camp = await Campaign.findById(campaign_id);
    
    await Disbursement.create({ campaign_id, campaign_title: camp.title, amount, vendor_name, invoice_number, description });
    await logAudit('Disbursement', 'CREATED', { campaign_id, amount, vendor: vendor_name });
    res.json({ message: 'Disbursement recorded successfully' });
});

app.get('/api/admin/audit', authenticate, isAdmin, async (req, res) => {
    const rows = await AuditLog.find().sort({ created_at: -1 }).limit(100);
    res.json(rows.map(r => ({ ...r.toObject(), id: r._id })));
});

app.listen(PORT, () => console.log(`🚀 Production Server running on port ${PORT}`));