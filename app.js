const express = require('express');
const cors = require('cors');
const { config } = require('dotenv');

const authRoutes = require('./routes/auth');
const articleRoutes = require('./routes/articles');
const commentRoutes = require('./routes/comments');
const uploadRoutes = require('./routes/upload');
const userRoutes = require('./routes/users');
const categoryRoutes = require('./routes/categories');

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