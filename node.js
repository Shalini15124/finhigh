// FINHIGH Backend Server
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later' }
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files (your HTML file)
app.use(express.static(path.join(__dirname, 'public')));

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'finhigh_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('Database connected successfully');
        connection.release();
    } catch (error) {
        console.error('Database connection failed:', error.message);
        process.exit(1);
    }
}

// Middleware to verify JWT token
const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Error handling middleware
const handleError = (error, req, res, next) => {
    console.error('Error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
};

// AUTHENTICATION ROUTES

// User registration/login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { name, email, monthlyAllowance } = req.body;
        
        if (!name || !email || !monthlyAllowance || monthlyAllowance <= 0) {
            return res.status(400).json({ error: 'All fields are required and allowance must be positive' });
        }
        
        const connection = await pool.getConnection();
        
        try {
            // Check if user exists
            const [existingUsers] = await connection.execute(
                'SELECT id FROM users WHERE email = ?',
                [email]
            );
            
            let userId;
            
            if (existingUsers.length > 0) {
                // User exists, update their info
                userId = existingUsers[0].id;
                await connection.execute(
                    'UPDATE users SET name = ?, monthly_allowance = ? WHERE id = ?',
                    [name, monthlyAllowance, userId]
                );
            } else {
                // Create new user using stored procedure
                const [result] = await connection.execute(
                    'CALL AddNewUser(?, ?, ?)',
                    [name, email, monthlyAllowance]
                );
                userId = result[0][0].user_id;
            }
            
            // Generate JWT token
            const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
            
            // Get user data
            const [userData] = await connection.execute(
                'SELECT id, name, email, monthly_allowance, current_balance, total_savings, total_spent, notes FROM users WHERE id = ?',
                [userId]
            );
            
            res.json({
                success: true,
                message: 'Login successful',
                token,
                user: userData[0]
            });
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// USER DATA ROUTES

// Get user dashboard data
app.get('/api/user/dashboard', verifyToken, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        try {
            // Get user data and expense summaries using stored procedure
            const [results] = await connection.execute('CALL GetUserDashboard(?)', [req.userId]);
            
            const userData = results[0][0];
            const expenseSummaries = results[1];
            const recentTransactions = results[2];
            
            // Format expense data
            const expenses = {};
            expenseSummaries.forEach(summary => {
                expenses[summary.category] = summary.total_amount;
            });
            
            // Format transactions
            const transactions = recentTransactions.map(t => ({
                id: t.id,
                type: t.transaction_type,
                category: t.category,
                amount: parseFloat(t.amount),
                description: t.description || 'No description',
                source: t.source,
                date: t.transaction_date.toISOString(),
                displayDate: new Date(t.transaction_date).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })
            }));
            
            res.json({
                success: true,
                data: {
                    balance: parseFloat(userData.current_balance),
                    savings: parseFloat(userData.total_savings),
                    totalSpent: parseFloat(userData.total_spent),
                    expenses,
                    notes: userData.notes || '',
                    transactions,
                    user: {
                        id: userData.id,
                        name: userData.name,
                        email: userData.email,
                        allowance: parseFloat(userData.monthly_allowance)
                    }
                }
            });
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
});

// Update user notes
app.put('/api/user/notes', verifyToken, async (req, res) => {
    try {
        const { notes } = req.body;
        
        const connection = await pool.getConnection();
        
        try {
            await connection.execute(
                'UPDATE users SET notes = ? WHERE id = ?',
                [notes, req.userId]
            );
            
            res.json({ success: true, message: 'Notes saved successfully' });
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Notes update error:', error);
        res.status(500).json({ error: 'Failed to save notes' });
    }
});

// TRANSACTION ROUTES

// Add expense
app.post('/api/transactions/expense', verifyToken, async (req, res) => {
    try {
        const { amount, category, description = '' } = req.body;
        
        if (!amount || amount <= 0 || !category) {
            return res.status(400).json({ error: 'Amount and category are required' });
        }
        
        const connection = await pool.getConnection();
        
        try {
            // Use stored procedure to add expense
            const [result] = await connection.execute(
                'CALL AddExpenseTransaction(?, ?, ?, ?)',
                [req.userId, category, amount, description]
            );
            
            const response = result[0][0];
            
            if (response.status === 'SUCCESS') {
                res.json({ success: true, message: response.message });
            } else {
                res.status(400).json({ error: response.message });
            }
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Add expense error:', error);
        res.status(500).json({ error: 'Failed to add expense' });
    }
});

// Add income
app.post('/api/transactions/income', verifyToken, async (req, res) => {
    try {
        const { amount, source, description = '' } = req.body;
        
        if (!amount || amount <= 0 || !source) {
            return res.status(400).json({ error: 'Amount and source are required' });
        }
        
        const connection = await pool.getConnection();
        
        try {
            // Use stored procedure to add income
            const [result] = await connection.execute(
                'CALL AddIncomeTransaction(?, ?, ?, ?)',
                [req.userId, amount, source, description]
            );
            
            const response = result[0][0];
            
            res.json({ success: true, message: response.message });
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Add income error:', error);
        res.status(500).json({ error: 'Failed to add income' });
    }
});

// Get category transactions
app.get('/api/transactions/category/:category', verifyToken, async (req, res) => {
    try {
        const { category } = req.params;
        
        const connection = await pool.getConnection();
        
        try {
            const [transactions] = await connection.execute(
                `SELECT id, amount, description, transaction_date, 
                 DATE_FORMAT(transaction_date, '%d %M %Y at %h:%i %p') as formatted_date
                 FROM transactions 
                 WHERE user_id = ? AND category = ? AND transaction_type = 'expense'
                 ORDER BY transaction_date DESC`,
                [req.userId, category]
            );
            
            // Get category total
            const [summary] = await connection.execute(
                'SELECT total_amount, transaction_count FROM user_expense_summaries WHERE user_id = ? AND category = ?',
                [req.userId, category]
            );
            
            const categoryData = summary[0] || { total_amount: 0, transaction_count: 0 };
            
            res.json({
                success: true,
                data: {
                    category,
                    total: parseFloat(categoryData.total_amount),
                    count: categoryData.transaction_count,
                    transactions: transactions.map(t => ({
                        id: t.id,
                        amount: parseFloat(t.amount),
                        description: t.description || 'No description',
                        date: t.transaction_date.toISOString(),
                        displayDate: t.formatted_date
                    }))
                }
            });
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Category transactions error:', error);
        res.status(500).json({ error: 'Failed to fetch category transactions' });
    }
});

// Get all transactions
app.get('/api/transactions', verifyToken, async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        
        const connection = await pool.getConnection();
        
        try {
            const [transactions] = await connection.execute(
                `SELECT id, transaction_type, category, amount, description, source, transaction_date,
                 DATE_FORMAT(transaction_date, '%d %M %Y at %h:%i %p') as formatted_date
                 FROM transactions 
                 WHERE user_id = ? 
                 ORDER BY transaction_date DESC 
                 LIMIT ? OFFSET ?`,
                [req.userId, parseInt(limit), parseInt(offset)]
            );
            
            res.json({
                success: true,
                data: transactions.map(t => ({
                    id: t.id,
                    type: t.transaction_type,
                    category: t.category,
                    amount: parseFloat(t.amount),
                    description: t.description || 'No description',
                    source: t.source,
                    date: t.transaction_date.toISOString(),
                    displayDate: t.formatted_date
                }))
            });
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Transactions error:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// AI CHAT ROUTES

// Save chat message
app.post('/api/chat/message', verifyToken, async (req, res) => {
    try {
        const { message, messageType } = req.body;
        
        if (!message || !messageType) {
            return res.status(400).json({ error: 'Message and type are required' });
        }
        
        const connection = await pool.getConnection();
        
        try {
            await connection.execute(
                'INSERT INTO chat_messages (user_id, message_type, message_content) VALUES (?, ?, ?)',
                [req.userId, messageType, message]
            );
            
            res.json({ success: true, message: 'Chat message saved' });
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Chat message error:', error);
        res.status(500).json({ error: 'Failed to save chat message' });
    }
});

// Get chat history
app.get('/api/chat/history', verifyToken, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        try {
            const [messages] = await connection.execute(
                'SELECT message_type, message_content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 50',
                [req.userId]
            );
            
            res.json({
                success: true,
                data: messages.map(m => ({
                    type: m.message_type,
                    content: m.message_content,
                    timestamp: m.created_at
                }))
            });
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Chat history error:', error);
        res.status(500).json({ error: 'Failed to fetch chat history' });
    }
});

// ANALYTICS ROUTES

// Get spending analysis
app.get('/api/analytics/spending', verifyToken, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        try {
            const [analysis] = await connection.execute(
                'SELECT * FROM spending_analysis_view WHERE user_id = ?',
                [req.userId]
            );
            
            if (analysis.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            const data = analysis[0];
            
            res.json({
                success: true,
                data: {
                    monthlyAllowance: parseFloat(data.monthly_allowance),
                    currentBalance: parseFloat(data.current_balance),
                    totalSpent: parseFloat(data.total_spent),
                    totalSavings: parseFloat(data.total_savings),
                    spentPercentage: parseFloat(data.spent_percentage),
                    spendingStatus: data.spending_status
                }
            });
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// UTILITY ROUTES

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Get expense categories
app.get('/api/categories', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        try {
            const [categories] = await connection.execute(
                'SELECT category_name, icon_class, display_name FROM expense_categories ORDER BY category_name'
            );
            
            res.json({
                success: true,
                data: categories.reduce((acc, cat) => {
                    acc[cat.category_name] = {
                        icon: cat.icon_class,
                        label: cat.display_name
                    };
                    return acc;
                }, {})
            });
            
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Categories error:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle 404
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use(handleError);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    await pool.end();
    process.exit(0);
});

// Start server
async function startServer() {
    await testConnection();
    
    app.listen(PORT, () => {
        console.log(FINHIGH Server running on port ${PORT});
        console.log(Environment: ${process.env.NODE_ENV || 'development'});
        console.log(Frontend URL: ${process.env.FRONTEND_URL || 'All origins allowed'});
    });
}
