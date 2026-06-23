#!/bin/bash
cd /home/ubuntu/teamconnect

echo "=== DATA DIR ==="
ls -la data/

echo "=== USERS DATA ==="
cat data/users.json 2>/dev/null || echo "no users.json"

echo "=== TOKEN DECODE ==="
node -e "
const jwt = require('jsonwebtoken');
require('dotenv').config();
const http = require('http');
const data = JSON.stringify({username:'admin',password:'admin123'});
const req = http.request({hostname:'localhost',port:3000,path:'/api/auth/login',method:'POST',headers:{'Content-Type':'application/json','Content-Length':data.length}}, res => {
  let body = '';
  res.on('data',c => body+=c);
  res.on('end',() => {
    const r = JSON.parse(body);
    if(r.token) {
      const decoded = jwt.decode(r.token);
      console.log('User ID:', decoded.id);
      console.log('Username:', decoded.username);
    } else {
      console.log('No token in response:', JSON.stringify(r));
    }
  });
});
req.write(data); req.end();
"
