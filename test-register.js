// Test script to register users on server
const http = require('http');

const testUsers = ['alice', 'bob', 'charlie', 'david', 'eve'];

function registerUser(username) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ username: username });
        
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/register',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };
        
        const req = http.request(options, (res) => {
            let body = '';
            
            res.on('data', (chunk) => {
                body += chunk;
            });
            
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (response.success) {
                        console.log(`✅ Пользователь ${username} зарегистрирован`);
                        resolve(response);
                    } else {
                        console.log(`⚠️ ${username}: ${response.error}`);
                        resolve(response);
                    }
                } catch (error) {
                    console.error(`❌ Ошибка парсинга ответа для ${username}:`, error);
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error(`❌ Ошибка регистрации ${username}:`, error);
            reject(error);
        });
        
        req.write(data);
        req.end();
    });
}

async function registerAllUsers() {
    console.log('🚀 Начинаем регистрацию тестовых пользователей...\n');
    
    for (const username of testUsers) {
        await registerUser(username);
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
    }
    
    console.log('\n✅ Регистрация завершена!');
    console.log('\nТеперь вы можете войти под любым пользователем:');
    testUsers.forEach(user => console.log(`  - ${user}`));
    console.log('\n(используйте любой пароль при первом входе)');
}

registerAllUsers().catch(error => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
});
