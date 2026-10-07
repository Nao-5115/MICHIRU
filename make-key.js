const { generateKeyPairSync } = require('crypto');
const fs = require('fs');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
fs.writeFileSync('key.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }));
console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));