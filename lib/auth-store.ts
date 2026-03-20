import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

export interface User {
  id: string;
  email: string;
  name: string;
  password: string;
  createdAt: string;
  updatedAt: string;
}

const USERS_FILE = path.join(process.cwd(), 'data', 'users.json');

// Ensure data directory exists
const dataDir = path.dirname(USERS_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize with empty users array if file doesn't exist
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
}

export const userStore = {
  async findByEmail(email: string): Promise<User | null> {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    return users.find((user: User) => user.email.toLowerCase() === email.toLowerCase()) || null;
  },

  async findById(id: string): Promise<User | null> {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    return users.find((user: User) => user.id === id) || null;
  },

  async create(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    
    const newUser: User = {
      ...userData,
      id: `user_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    users.push(newUser);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    
    return newUser;
  },

  async validatePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  },

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  },

  // Create default admin user if no users exist
  async updatePassword(userId: string, newPassword: string): Promise<boolean> {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    const user = users.find((u: User) => u.id === userId);
    
    if (!user) return false;
    
    const hashedPassword = await this.hashPassword(newPassword);
    user.password = hashedPassword;
    user.updatedAt = new Date().toISOString();
    
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return true;
  },

  async updateProfile(userId: string, name: string): Promise<User | null> {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    const userIndex = users.findIndex((u: User) => u.id === userId);
    
    if (userIndex === -1) return null;
    
    users[userIndex].name = name;
    users[userIndex].updatedAt = new Date().toISOString();
    
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return users[userIndex];
  },

  async initDefaultUser(): Promise<void> {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    if (users.length === 0) {
      const hashedPassword = await this.hashPassword('admin123');
      await this.create({
        email: 'admin@example.com',
        name: 'Admin User',
        password: hashedPassword,
      });
      console.log('Default user created: admin@example.com / admin123');
    }
  },
};
