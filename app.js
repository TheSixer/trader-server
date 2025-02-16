import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';

import authRoutes from './routes/auth.js';
import articleRoutes from './routes/articles.js';
import commentRoutes from './routes/comments.js';
import uploadRoutes from './routes/upload.js';
import userRoutes from './routes/users.js';
import categoryRoutes from './routes/categories.js';

config();

const app = express();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/posts', articleRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
}); 