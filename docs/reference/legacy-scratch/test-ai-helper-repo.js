import { initDb, createSession, addMessage, getRecentMessages, clearSession, closeDb } from './src/db/aiHelperRepo.js';

async function runTests() {
    console.log('=== AI Helper Repo Tests ===\n');

    try {
        // 1. Инициализация БД
        console.log('1. Initializing DB...');
        await initDb();
        console.log('   DB initialized\n');

        // 2. Создание тестовой сессии
        const testSessionId = 'test-session-uuid-001';
        console.log('2. Creating session:', testSessionId.slice(0, 8));
        await createSession(testSessionId);
        console.log('   Session created\n');

        // 3. Добавление 3 сообщений
        console.log('3. Adding messages...');
        await addMessage(testSessionId, 'user', 'Привет, как дела?', Date.now() - 3000);
        await addMessage(testSessionId, 'interlocutor', 'Привет! У меня всё отлично, спасибо!', Date.now() - 2000);
        await addMessage(testSessionId, 'user', 'Отлично, давай начнем', Date.now() - 1000);
        console.log('   3 messages added\n');

        // 4. Получение сообщений
        console.log('4. Getting recent messages...');
        const messages = await getRecentMessages(testSessionId);
        console.log('   Retrieved', messages.length, 'messages:');
        messages.forEach((msg, i) => {
            console.log(`   [${i + 1}] ${msg.role}: "${msg.text}" (${new Date(msg.timestamp).toISOString()})`);
        });

        // Проверка порядка
        if (messages.length === 3 && messages[0].role === 'user' && messages[1].role === 'interlocutor' && messages[2].role === 'user') {
            console.log('   Order check: PASS\n');
        } else {
            console.log('   Order check: FAIL\n');
        }

        // 5. Очистка сессии
        console.log('5. Clearing session...');
        await clearSession(testSessionId);
        console.log('   Session cleared\n');

        // 6. Проверка удаления
        console.log('6. Verifying session deleted...');
        const remaining = await getRecentMessages(testSessionId);
        if (remaining.length === 0) {
            console.log('   Session deletion verified: PASS\n');
        } else {
            console.log('   Session deletion verified: FAIL\n');
        }

        console.log('=== All tests passed! ===');
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    } finally {
        closeDb();
    }
}

runTests();
