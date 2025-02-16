const bcrypt = require('bcrypt');

async function generateHash() {
  const password = 'Longjia.3713';
  const hash = await bcrypt.hash(password, 10);
  console.log('Password:', password);
  console.log('Hash:', hash);
  
  // 验证
  const isValid = await bcrypt.compare(password, hash);
  console.log('Verification:', isValid);
}

generateHash(); 