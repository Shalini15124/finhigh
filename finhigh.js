// Database Setup Script for FINHIGH
const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
};

const setupDatabase = async () => {
    let connection;
    
    try {
        console.log('Connecting to MySQL server...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to MySQL server');

        // Create database if it doesn't exist
        const dbName = process.env.DB_NAME || 'finhigh_db';
        await connection.execute(CREATE DATABASE IF NOT EXISTS ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci);
        console.log(✅ Database '${dbName}' created/verified);

        // Use the database
        await connection.execute(USE ${dbName});

        // Create tables
        console.log('Creating tables...');

        // Users table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                monthly_allowance DECIMAL(10,2) NOT NULL,
                current_balance DECIMAL(10,2) DEFAULT 0.00,
                total_savings DECIMAL(10,2) DEFAULT 0.00,
                total_spent DECIMAL(10,2) DEFAULT 0.00,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_email (email),
                INDEX idx_created_at (created_at)
            )
        `);
        console.log('✅ Users table created');

        // Expense categories table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS expense_categories (
                id INT PRIMARY KEY AUTO_INCREMENT,
                category_name VARCHAR(100) NOT NULL UNIQUE,
                icon_class VARCHAR(100) NOT NULL,
                display_name VARCHAR(150) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Expense categories table created');

        // Insert default categories
        await connection.execute(`
            INSERT IGNORE INTO expense_categories (category_name, icon_class, display_name) VALUES
            ('food', 'fas fa-utensils', 'Food & Dining'),
            ('shopping', 'fas fa-shopping-bag', 'Shopping'),
            ('friends', 'fas fa-users', 'Friends & Social'),
            ('weekend', 'fas fa-glass-cheers', 'Weekend Outing'),
            ('social', 'fas fa-hands-helping', 'Social Service')
        `);
        console.log('✅ Default expense categories inserted');

        // Transactions table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS transactions (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                transaction_type ENUM('income', 'expense') NOT NULL,
                category VARCHAR(100),
                amount DECIMAL(10,2) NOT NULL,
                description TEXT,
                source VARCHAR(100),
                transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_id (user_id),
                INDEX idx_transaction_type (transaction_type),
                INDEX idx_category (category),
                INDEX idx_transaction_date (transaction_date)
            )
        `);
        console.log('✅ Transactions table created');

        // User expense summaries table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS user_expense_summaries (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                category VARCHAR(100) NOT NULL,
                total_amount DECIMAL(10,2) DEFAULT 0.00,
                transaction_count INT DEFAULT 0,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_user_category (user_id, category),
                INDEX idx_user_id (user_id),
                INDEX idx_category (category)
            )
        `);
        console.log('✅ User expense summaries table created');

        // AI Chat messages table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                message_type ENUM('user', 'ai') NOT NULL,
                message_content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_id (user_id),
                INDEX idx_created_at (created_at)
            )
        `);
        console.log('✅ Chat messages table created');

        // Financial goals table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS financial_goals (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                goal_name VARCHAR(255) NOT NULL,
                target_amount DECIMAL(10,2) NOT NULL,
                current_amount DECIMAL(10,2) DEFAULT 0.00,
                target_date DATE,
                status ENUM('active', 'completed', 'paused') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_id (user_id),
                INDEX idx_status (status)
            )
        `);
        console.log('✅ Financial goals table created');

        // Reminders table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS reminders (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                reminder_type VARCHAR(100) NOT NULL,
                message TEXT NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_id (user_id),
                INDEX idx_reminder_type (reminder_type)
            )
        `);
        console.log('✅ Reminders table created');

        // Create stored procedures
        console.log('Creating stored procedures...');

        // Drop existing procedures if they exist
        await connection.execute('DROP PROCEDURE IF EXISTS AddNewUser');
        await connection.execute('DROP PROCEDURE IF EXISTS AddExpenseTransaction');
        await connection.execute('DROP PROCEDURE IF EXISTS AddIncomeTransaction');
        await connection.execute('DROP PROCEDURE IF EXISTS GetUserDashboard');

        // AddNewUser procedure
        await connection.execute(`
            CREATE PROCEDURE AddNewUser(
                IN p_name VARCHAR(255),
                IN p_email VARCHAR(255),
                IN p_allowance DECIMAL(10,2)
            )
            BEGIN
                DECLARE savings_deduction DECIMAL(10,2) DEFAULT 100.00;
                DECLARE available_balance DECIMAL(10,2);
                DECLARE new_user_id INT;
                
                SET available_balance = p_allowance - savings_deduction;
                
                START TRANSACTION;
                
                INSERT INTO users (name, email, monthly_allowance, current_balance, total_savings)
                VALUES (p_name, p_email, p_allowance, available_balance, savings_deduction);
                
                SET new_user_id = LAST_INSERT_ID();
                
                INSERT INTO user_expense_summaries (user_id, category, total_amount)
                SELECT new_user_id, category_name, 0.00
                FROM expense_categories;
                
                COMMIT;
                
                SELECT new_user_id as user_id;
            END
        `);
        console.log('✅ AddNewUser procedure created');

        // AddExpenseTransaction procedure
        await connection.execute(`
            CREATE PROCEDURE AddExpenseTransaction(
                IN p_user_id INT,
                IN p_category VARCHAR(100),
                IN p_amount DECIMAL(10,2),
                IN p_description TEXT
            )
            BEGIN
                DECLARE current_bal DECIMAL(10,2);
                
                SELECT current_balance INTO current_bal FROM users WHERE id = p_user_id;
                
                IF current_bal >= p_amount THEN
                    START TRANSACTION;
                    
                    INSERT INTO transactions (user_id, transaction_type, category, amount, description)
                    VALUES (p_user_id, 'expense', p_category, p_amount, p_description);
                    
                    UPDATE users 
                    SET current_balance = current_balance - p_amount,
                        total_spent = total_spent + p_amount
                    WHERE id = p_user_id;
                    
                    INSERT INTO user_expense_summaries (user_id, category, total_amount, transaction_count)
                    VALUES (p_user_id, p_category, p_amount, 1)
                    ON DUPLICATE KEY UPDATE
                        total_amount = total_amount + p_amount,
                        transaction_count = transaction_count + 1;
                    
                    COMMIT;
                    SELECT 'SUCCESS' as status, 'Expense added successfully' as message;
                ELSE
                    SELECT 'ERROR' as status, 'Insufficient balance' as message;
                END IF;
            END
        `);
        console.log('✅ AddExpenseTransaction procedure created');

        // AddIncomeTransaction procedure
        await connection.execute(`
            CREATE PROCEDURE AddIncomeTransaction(
                IN p_user_id INT,
                IN p_amount DECIMAL(10,2),
                IN p_source VARCHAR(100),
                IN p_description TEXT
            )
            BEGIN
                DECLARE savings_amount DECIMAL(10,2);
                DECLARE balance_amount DECIMAL(10,2);
                
                SET savings_amount = p_amount / 2;
                SET balance_amount = p_amount / 2;
                
                START TRANSACTION;
                
                INSERT INTO transactions (user_id, transaction_type, amount, source, description)
                VALUES (p_user_id, 'income', p_amount, p_source, p_description);
                
                UPDATE users 
                SET current_balance = current_balance + balance_amount,
                    total_savings = total_savings + savings_amount
                WHERE id = p_user_id;
                
                COMMIT;
                SELECT 'SUCCESS' as status, 'Income added successfully' as message;
            END
        `);
        console.log('✅ AddIncomeTransaction procedure created');

        // GetUserDashboard procedure
        await connection.execute(`
            CREATE PROCEDURE GetUserDashboard(IN p_user_id INT)
            BEGIN
                SELECT 
                    id, name, email, monthly_allowance, current_balance, 
                    total_savings, total_spent, notes
                FROM users 
                WHERE id = p_user_id;
                
                SELECT 
                    ues.category, 
                    ues.total_amount, 
                    ues.transaction_count,
                    ec.icon_class,
                    ec.display_name
                FROM user_expense_summaries ues
                JOIN expense_categories ec ON ues.category = ec.category_name
                WHERE ues.user_id = p_user_id
                ORDER BY ues.total_amount DESC;
                
                SELECT 
                    id, transaction_type, category, amount, description, 
                    source, transaction_date
                FROM transactions 
                WHERE user_id = p_user_id 
                ORDER BY transaction_date DESC 
                LIMIT 20;
            END
        `);
        console.log('✅ GetUserDashboard procedure created');

        // Create views
        console.log('Creating views...');

        await connection.execute('DROP VIEW IF EXISTS transaction_history_view');
        await connection.execute(`
            CREATE VIEW transaction_history_view AS
            SELECT 
                t.id,
                t.user_id,
                t.transaction_type,
                t.category,
                t.amount,
                t.description,
                t.source,
                t.transaction_date,
                DATE_FORMAT(t.transaction_date, '%d %M %Y at %h:%i %p') as formatted_date,
                u.name as user_name
            FROM transactions t
            JOIN users u ON t.user_id = u.id
        `);
        console.log('✅ Transaction history view created');

        await connection.execute('DROP VIEW IF EXISTS spending_analysis_view');
        await connection.execute(`
            CREATE VIEW spending_analysis_view AS
            SELECT 
                u.id as user_id,
                u.name,
                u.monthly_allowance,
                u.current_balance,
                u.total_spent,
                u.total_savings,
                ROUND((u.total_spent / u.monthly_allowance) * 100, 2) as spent_percentage,
                CASE 
                    WHEN (u.total_spent / u.monthly_allowance) * 100 < 50 THEN 'GOOD'
                    WHEN (u.total_spent / u.monthly_allowance) * 100 < 75 THEN 'MODERATE'
                    ELSE 'HIGH'
                END as spending_status
            FROM users u
        `);
        console.log('✅ Spending analysis view created');

        // Create additional indexes
        await connection.execute('CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at)');
        await connection.execute('CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, transaction_date)');
        await connection.execute('CREATE INDEX IF NOT EXISTS idx_expense_summaries_user_category ON user_expense_summaries(user_id, category)');
        console.log('✅ Additional indexes created');

        // Insert sample data for testing (optional)
        const insertSampleData = process.argv.includes('--sample-data');
        if (insertSampleData) {
            console.log('Inserting sample data...');
            
            // Check if sample user already exists
            const [existingUser] = await connection.execute(
                'SELECT id FROM users WHERE email = ?',
                ['demo@finhigh.com']
            );
            
            if (existingUser.length === 0) {
                await connection.execute('CALL AddNewUser(?, ?, ?)', [
                    'Demo User',
                    'demo@finhigh.com',
                    5000.00
                ]);
                
                console.log('✅ Sample user created (demo@finhigh.com)');
                
                // Add some sample transactions
                await connection.execute('CALL AddExpenseTransaction(?, ?, ?, ?)', [
                    1, 'food', 250.00, 'Lunch at college cafeteria'
                ]);
                
                await connection.execute('CALL AddExpenseTransaction(?, ?, ?, ?)', [
                    1, 'shopping', 800.00, 'Bought new books and stationery'
                ]);
                
                await connection.execute('CALL AddIncomeTransaction(?, ?, ?, ?)', [
                    1, 1000.00, 'freelancing', 'Web development project'
                ]);
                
                console.log('✅ Sample transactions added');
            }
        }

        console.log('\n🎉 Database setup completed successfully!');
        console.log('\nSetup Summary:');
        console.log('✅ Database created');
        console.log('✅ All tables created');
        console.log('✅ Stored procedures created');
        console.log('✅ Views created');
        console.log('✅ Indexes created');
        console.log('✅ Default categories inserted');
        
        if (insertSampleData) {
            console.log('✅ Sample data inserted');
        }
        
        console.log('\nYou can now start the server with: npm start');
        console.log('or npm run dev for development mode');

    } catch (error) {
        console.error('❌ Database setup failed:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};

// Run setup
setupDatabase();
