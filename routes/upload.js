import express from 'express';
import multer from 'multer';
import qiniu from 'qiniu';
import verifyToken from '../middleware/auth.js';
import { config } from 'dotenv';
import crypto from 'crypto';

config();

const router = express.Router();

// 配置multer
const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // 只允许上传图片
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件！'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 限制5MB
  }
}).single('file');  // 修改为 'file'，与前端保持一致

// 配置七牛云
const mac = new qiniu.auth.digest.Mac(
  process.env.QINIU_ACCESS_KEY,
  process.env.QINIU_SECRET_KEY
);

const options = {
  scope: process.env.QINIU_BUCKET,
  returnBody: '{"key":"$(key)","hash":"$(etag)","fsize":$(fsize)}'
};

const putPolicy = new qiniu.rs.PutPolicy(options);
const uploadToken = putPolicy.uploadToken(mac);

const qiniuConfig = new qiniu.conf.Config();

// 生成随机文件名
const generateRandomFileName = (originalName) => {
  const ext = originalName.split('.').pop();
  const randomStr = crypto.randomBytes(16).toString('hex');
  return `${randomStr}.${ext}`;
};

// 上传图片
router.post('/', verifyToken, (req, res) => {
  console.log('开始处理上传请求');
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer错误:', err);
      return res.status(400).json({ message: '文件上传错误：' + err.message });
    } else if (err) {
      console.error('其他错误:', err);
      return res.status(400).json({ message: err.message });
    }

    if (!req.file) {
      console.error('没有文件被上传');
      return res.status(400).json({ message: '请选择要上传的文件' });
    }

    console.log('文件信息:', {
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    const formUploader = new qiniu.form_up.FormUploader(qiniuConfig);
    const putExtra = new qiniu.form_up.PutExtra();
    const key = generateRandomFileName(req.file.originalname);

    console.log('七牛云配置:', {
      bucket: process.env.QINIU_BUCKET,
      key: key,
      tokenValid: !!uploadToken
    });

    try {
      const result = await new Promise((resolve, reject) => {
        formUploader.put(
          uploadToken,
          key,
          req.file.buffer,
          putExtra,
          (err, body, info) => {
            console.log('七牛云上传回调:', { err, body, info });
            if (err) {
              console.error('七牛云上传错误:', err);
              reject(err);
            } else if (info.statusCode !== 200) {
              console.error('七牛云返回非200状态:', info);
              reject(new Error(`上传失败: ${info.statusCode}`));
            } else {
              resolve(body);
            }
          }
        );
      });

      console.log('上传成功，结果:', result);
      const baseUrl = process.env.QINIU_DOMAIN + '/' + result.key;

      res.json({ url: baseUrl });
    } catch (error) {
      console.error('完整的上传错误:', error);
      res.status(500).json({ 
        message: '文件上传失败',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
});

export default router; 