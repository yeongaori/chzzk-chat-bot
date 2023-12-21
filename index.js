const {Builder, By, Key, until} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs').promises;

process.title = 'CHZZK ChatBot';

let driver;
let config = {};
let commandsData = [];

async function loadConfig() {
    try {
        sendConsole('Reading config file...');
        const data = await fs.readFile('config.json', 'utf8');
        config = JSON.parse(data);
    } catch (e) {
        sendConsole('Error reading config file: ' + e);
        config = {};
    }
}

async function loadCommands() {
    try {
        const data = await fs.readFile('commands.json', 'utf8');
        commandsData = JSON.parse(data);
    } catch (e) {
        sendConsole('Error reading commands file: ' + e);
        commandsData = [];
    }
}

async function runBot() {
    try {
        await loadConfig();

        let savedWebSocketData = '';

        let options = new chrome.Options();
        options.addArguments(
            `user-data-dir=${__dirname}/browserData`,
            "--disable-gpu",
            "window-size=1920x1080",
            "lang=ko_KR",
            "--host-resolver-rules=MAP livecloud.pstatic.net 127.0.0.1, MAP livecloud.akamaized.net 127.0.0.1"
        )

        if (config.headlessMode) {
            options.headless().addArguments('console');
        }

        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        const url = config.url;
        await driver.get(url);

        const channelId = url.split('chzzk.naver.com/live/')[1]?.split('/')[0];
        if (channelId) {
            sendConsole('Found channel Id: ' + channelId);
        } else {
            sendConsole('Error getting channelId, wrong URL?');
        }

        await injectScriptLoop(url);
        await checkLoginStatus(url);

        setInterval(async () => {
            const browserSavedData = await driver.executeScript('return window.savedWebSocketData;');
            if (browserSavedData) {
                savedWebSocketData = browserSavedData;
                const wsData = JSON.parse(savedWebSocketData);
                if (wsData.ver == 1) {
                    wsReceived(wsData);
                }
                await driver.executeScript('window.savedWebSocketData = "";');
            }
        }, 100);
    } catch (e) {
        sendConsole(e);
    }
}

async function checkLoginStatus(url) {
    let currentUrl = '';
    currentUrl = await driver.getCurrentUrl();
    let isLoggedIn = false;
    if (currentUrl == url) {
        sendConsole('Waiting 3 seconds for website to load');
        await driver.sleep(3000);
        isLoggedIn = await driver.executeScript(
            'var elements=document.querySelectorAll(\'[class^=\"toolbar_button\"]\');for(var i=0; i<elements.length;i++){if(elements[i].textContent.trim()===\'로그인\'){return false;}}return true;'
        );
    }

    if (isLoggedIn) {
        sendConsole('User logged in');
        sendConsole('Started listening chat');
        return;
    } else {
        if (currentUrl == url) {
            sendConsole('User not logged in, please log in');
            if (config.headlessMode) {
                sendConsole('Please disable headlessMode in config.json to log in');
            }
            currentUrl = 'https://nid.naver.com/nidlogin.login?url=' + url;
            await driver.get('https://nid.naver.com/nidlogin.login?url=' + url);
        }
        await driver.sleep(5000);
        checkLoginStatus(url);
    }
}

async function sendConsole(text) {
    console.log('[CHZZK ChatBot] ' + text);
    if (config.saveLog) {
        saveLog(`CONSOLE / ${text}`);
    }
}

async function wsReceived(wsData) {
    const bdyData = wsData.bdy[0];
    const profileData = JSON.parse(bdyData.profile);
    const nickname = profileData.nickname;
    const message = bdyData.msg;
    const msgTypeCode = bdyData.msgTypeCode;

    if (config.saveLog) {
        saveLog(`MESSAGE / ${msgTypeCode} / ${nickname} / ${message}`);
    }

    commandsData.forEach(async (commandsData) => {
        if (message.startsWith(commandsData.command) && msgTypeCode === commandsData.msgTypeCode) {
            await sendMessage(commandsData.reply);
            if (config.saveLog) {
                saveLog(`COMMAND / ${commandsData.command} / ${commandsData.reply}`)
            }
        }
    });
}

async function sendMessage(message) {
    let textarea = await driver.findElement(By.css('[class^="live_chatting_input_input"]'));
    await driver.wait(until.elementIsVisible(textarea));
    await textarea.click();
    await driver.sleep(50);
    await driver.actions().sendKeys(message).perform();
    await driver.sleep(50);
    await driver.actions().sendKeys(Key.ENTER).perform();
}

async function saveLog(data) {
    const fileName = 'log.txt';
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const formattedDate = `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
    let text = `${formattedDate} / ${data}\n`;
    fs.appendFile(fileName, text, (e) => {
        if (e) {
            sendConsole(e);
        }
    });
}

async function injectScriptLoop(url) {
    let currentUrl = '';
    let isLoggedIn = false;
    const startTime = Date.now();

    while (!isLoggedIn && Date.now() - startTime < 10000) {
        currentUrl = await driver.getCurrentUrl();
        if (currentUrl === url) {
            isLoggedIn = true;
            const webSocketListener = await fs.readFile('./modules/webSocketListener.js', 'utf-8');
            await driver.executeScript(webSocketListener);
            sendConsole('Started listening chat');
        } else {
            await driver.sleep(100);
        }
    }
}


runBot();