const express = require('express');
const cors = require('cors');
const { config } = require('dotenv');
const path = require('path');

const authRoutes = require('./routes/auth');
const adminAuthRoutes = require('./routes/adminAuth');
const articleRoutes = require('./routes/articles');
const commentRoutes = require('./routes/comments');
const uploadRoutes = require('./routes/upload');
const userRoutes = require('./routes/users');
const categoryRoutes = require('./routes/categories');
const surveyRoutes = require('./routes/survey');
const customerRoutes = require('./routes/customer');

// 检查是否有 adminAuth 中间件
const adminAuth = require('./middleware/adminAuth');

config();

const app = express();

// 最简单的 CORS 配置 - 允许所有跨域请求
app.use(cors({
  origin: '*', // 允许任何来源
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: '*', // 允许任何请求头
  exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Type'],
  credentials: true,
  maxAge: 86400 // 24小时缓存预检请求结果
}));

// 在所有响应中添加 CORS 头的中间件
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // 快速响应预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).send();
  }
  
  next();
});

// 中间件
app.use(express.json({ limit: '10mb' })); // 增加请求体大小限制
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/posts', articleRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/survey', surveyRoutes);
app.use('/api/customers', customerRoutes);

// 静态文件服务
app.use('/reports', express.static(path.join(__dirname, 'reports')));

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    message: '服务器错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
}); 