const {Builder, By, Key, until} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs').promises;
const path = require('path');

process.title = 'CHZZK ChatBot';

let driver;
let config = {};
let channelId = "";
let commandsData = [];
let isLoggedIn = false;
let shouldInject = true;

async function loadConfig() {
    try {
        sendConsole('Reading config file...', 1);
        const data = await fs.readFile('config.json', 'utf8');
        config = JSON.parse(data);
    } catch (e) {
        sendConsole('Error reading config file: ' + e, 3);
        config = {};
    }
}

async function loadCommands() {
    try {
        const data = await fs.readFile('commands.json', 'utf8');
        commandsData = JSON.parse(data);
        for (const commandData of commandsData) {
            await sendConsole(`Command ${commandData.command} has been loaded!`, 0);
        }
    } catch (e) {
        sendConsole('Error reading commands file: ' + e, 3);
    }
}

async function copyApiBrowserData() {
  const sourceDirectory = path.join(__dirname, 'browserData');
  const destinationDirectory = path.join(__dirname, 'apiBrowserData');

  try {
    await fs.access(sourceDirectory);

    try {
      await fs.access(destinationDirectory);
      await fs.rm(destinationDirectory, { recursive: true });
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }

    await copyDirectory(sourceDirectory, destinationDirectory);

    sendConsole("BrowserData copied to ApiBrowserData successfully!", 0);
  } catch (e) {
    sendConsole(e.message || 'Source directory does not exist.', 3);
  }
}

async function runBot() {
    try {
        await loadConfig();
        await loadCommands();
        await copyApiBrowserData();

        let savedWebSocketData = '';

        let options = new chrome.Options();
        options.addArguments(
            `user-data-dir=${__dirname}/browserData`,
            "--disable-gpu",
            "window-size=1920x1080",
            "lang=ko_KR",
            "--host-resolver-rules=MAP livecloud.pstatic.net 127.0.0.1, MAP livecloud.akamaized.net 127.0.0.1",
            "console",
            "--log-level=3"
        )

        if (config.headlessMode) {
            options.headless();
        }

        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        const url = config.url;
        await driver.get(url);

        channelId = url.split('chzzk.naver.com/live/')[1]?.split('/')[0];
        if (channelId) {
            sendConsole('Found channel Id: ' + channelId, 1);
        } else {
            sendConsole('Error getting channelId, wrong URL?', 3);
        }

        (async () => {
            while (true) {
                await injectScriptLoop(url);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        })();
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
        sendConsole(e, 3);
    }
}

async function checkLoginStatus(url) {
    let currentUrl = '';
    currentUrl = await driver.getCurrentUrl();
    isLoggedIn = false;
    if (currentUrl == url) {
        sendConsole('Waiting 3 seconds for website to load', 0);
        await driver.sleep(3000);
        isLoggedIn = await driver.executeScript(
            'var elements=document.querySelectorAll(\'[class^=\"toolbar_item\"]\');for(var i=0; i<elements.length;i++){if(elements[i].textContent.trim()===\'로그인\'){return false;}}return true;'
        );
    }

    if (isLoggedIn) {
        sendConsole('User logged in', 1);
        return;
    } else {
        if (currentUrl == url) {
            sendConsole('User not logged in, please log in', 0);
            if (config.headlessMode) {
                sendConsole('Please disable headlessMode in config.json to log in', 2);
            }
            currentUrl = 'https://nid.naver.com/nidlogin.login?url=' + url;
            await driver.get('https://nid.naver.com/nidlogin.login?url=' + url);
        }
        sendConsole('Waiting 5 seconds for website to load', 0);
        await driver.sleep(5000);
        checkLoginStatus(url);
    }
}

/**
 * 
 * @param {string} text Text to print in console
 * @param {number|string} type 0: Normal client message, 1: Green client message, 2: Warning message, 3: Error message, String for custom message type
 */
async function sendConsole(text, type) {
    if (type == 0) {
        text = `\x1b[0m[Client] ${text}`;
    }
    else if (type == 1) {
        text = `\x1b[32m[Client] ${text}\x1b[0m`;
    }
    else if (type == 2) {
        text = `\x1b[33m[WARNING] ${text}\x1b[0m`;
    }
    else if (type == 3) {
        text = `\x1b[31m[Error] ${text}\x1b[0m`;
    }
    else if (typeof type == 'string') {
        text = `\x1b[0m[${type}] ${text}`;
    }
    else {
        text = `\x1b[35m[sendConsole] Unknown sendConsole type\x1b[0m`;
    }
    console.log(text);
}

async function wsReceived(wsData) {
    try {
        const bdyData = wsData.bdy[0];
        const profileData = JSON.parse(bdyData.profile);
        const nickname = profileData.nickname;
        const userId = profileData.userIdHash;
        const message = bdyData.msg;
        const msgTypeCode = bdyData.msgTypeCode;

        //console.log(wsData);
        //sendConsole(`${nickname} (${msgTypeCode}), ${message}`, 'Message');

        if (config.saveLog) {
            saveLog(`MESSAGE / ${msgTypeCode} / ${nickname} / ${message}`);
        }

        const cooldowns = new Map();
        for (const commandsDataItem of commandsData) {
            const commandKey = `${message}_${commandsDataItem.command}_${msgTypeCode}`;
            if (cooldowns.has(commandKey)) {
                const lastExecutionTime = cooldowns.get(commandKey);
                const currentTime = Date.now();
                const cooldownDuration = config.commandCooldown;
                if (currentTime - lastExecutionTime < cooldownDuration) {
                    //sendConsole(`Command ${commandsDataItem.command} is on cooldown.`, 0);
                    continue;
                }
            }
            cooldowns.set(commandKey, Date.now());

            if (message.startsWith(commandsDataItem.command) && msgTypeCode == commandsDataItem.msgTypeCode) {
                var replyMessage = commandsDataItem.reply;
                let chatChannelId = "";
                let liveDetailResponse = "";
                let liveStatusResponse = "";
                let channelProfileCardResponse = "";
                let userProfileCardResponse = "";
                //replyMessage = "nickname: [nickname] / channelName: [channelName] / message: [message] / title: [title] / uptime: [uptime] / concurrentUserCount: [concurrentUserCount] / accumulateCount: [accumulateCount] / categoryType: [categoryType] / liveCategory: [liveCategory] / liveCategoryValue: [liveCategoryValue] / chatActive: [chatActive] / chatAvailableGroup: [chatAvailableGroup] / paidPromotion: [paidPromotion] / followDate: [followDate]\n";

                try{
                    liveDetailResponse = await fetchApi(`https://api.chzzk.naver.com/service/v1/channels/${channelId}/live-detail`);
                    chatChannelId = await JSON.parse(liveDetailResponse).content.chatChannelId;
                } catch(e) {
                    sendConsole("Error handling liveDetailResponse API: " + e, 3);
                }
                try{
                    liveStatusResponse = await fetchApi(`https://api.chzzk.naver.com/polling/v1/channels/${channelId}/live-status`);
                } catch(e) {
                    sendConsole("Error handling liveStatusResponse API: " + e, 3);
                }
                try{
                    channelProfileCardResponse = await fetchApi(`https://comm-api.game.naver.com/nng_main/v1/chats/${chatChannelId}/users/${channelId}/profile-card?chatType=STREAMING`);
                } catch(e) {
                    sendConsole("Error handling channelProfileCardResponse API: " + e, 3);
                }
                try{
                    userProfileCardResponse = await fetchApi(`https://comm-api.game.naver.com/nng_main/v1/chats/${chatChannelId}/users/${userId}/profile-card?chatType=STREAMING`);
                } catch(e) {
                    sendConsole("Error handling userProfileCardResponse API: " + e, 3);
                }

                try{
                    if (replyMessage.includes("[nickname]")) {
                        replyMessage = replyMessage.replace("[nickname]", nickname)
                    }
                } catch (e) {
                    sendConsole("Error handling API [nickname]: " + e, 3);
                }
                try{
                    if (replyMessage.includes("[channelName]")) {
                        let channelName = JSON.parse(channelProfileCardResponse).content.nickname;
                        replyMessage = replyMessage.replace("[channelName]", channelName)
                    }
                } catch (e) {
                    sendConsole("Error handling API [channelName]: " + e, 3);
                }
                try{
                    if (replyMessage.includes("[message]")) {
                        replyMessage = replyMessage.replace("[message]", message)
                    }
                } catch (e) {
                    sendConsole("Error handling API [message]: " + e, 3);
                }
                try{
                    if (replyMessage.includes("[title]")) {
                        let title = JSON.parse(liveStatusResponse).content.liveTitle;
                        replyMessage = replyMessage.replace("[title]", title)
                    }
                } catch (e) {
                    sendConsole("Error handling API [title]: " + e, 3);
                }
                try{
                    if (replyMessage.includes("[uptime]")) {
                        let livePlaybackJson = JSON.parse(liveDetailResponse).content.livePlaybackJson.replace('\"', '"');
                        let uptime = getTimeDifference(JSON.parse(livePlaybackJson).live.start);
                        replyMessage = replyMessage.replace("[uptime]", uptime)
                    }
                } catch (e) {
                    sendConsole("Error handling API [uptime]: " + e, 3);
                }
                try{
                    if (replyMessage.includes("[concurrentUserCount]")) {
                        let concurrentUserCount = JSON.parse(liveStatusResponse).content.concurrentUserCount;
                        replyMessage = replyMessage.replace("[concurrentUserCount]", concurrentUserCount)
                    }
                } catch (e) {
                    sendConsole("Error handling API [concurrentUserCount]: " + e, 3);
                }
                try{
                    if (replyMessage.includes("[accumulateCount]")) {
                        let accumulateCount = JSON.parse(liveStatusResponse).content.accumulateCount;
                        replyMessage = replyMessage.replace("[accumulateCount]", accumulateCount)
                    }
                } catch (e) {
                    sendConsole("Error handling API [accumulateCount]: " + e, 3);
                }
                try{
                    if (replyMessage.includes("[categoryType]")) {
                        let categoryType = JSON.parse(liveStatusResponse).content.categoryType;
                        replyMessage = replyMessage.replace("[categoryType]", categoryType)
                    }
                } catch (e) {
                    sendConsole("Error handling API [categoryType]: " + e, 3);
                }
                try{
                    if (replyMessage.includes("[liveCategory]")) {
                        let liveCategory = JSON.parse(liveStatusResponse).content.liveCategory;
                        replyMessage = replyMessage.replace("[liveCategory]", liveCategory)
                    }
                } catch (e) {
                    sendConsole("Error handling API [liveCategory]: "+ e, 3);
                }
                try{
                    if (replyMessage.includes("[liveCategoryValue]")) {
                        let liveCategoryValue = JSON.parse(liveStatusResponse).content.liveCategoryValue;
                        replyMessage = replyMessage.replace("[liveCategoryValue]", liveCategoryValue)
                    }
                } catch (e) {
                    sendConsole("Error handling API [liveCategoryValue]: "+ e, 3);
                }
                try{
                    if (replyMessage.includes("[chatActive]")) {
                        let chatActive = JSON.parse(liveDetailResponse).content.chatActive;
                        replyMessage = replyMessage.replace("[chatActive]", chatActive)
                    }
                } catch (e) {
                    sendConsole("Error handling API [chatActive]: "+ e, 3);
                }
                try{
                    if (replyMessage.includes("[chatAvailableGroup]")) {
                        let chatAvailableGroup = JSON.parse(liveDetailResponse).content.chatAvailableGroup;
                        replyMessage = replyMessage.replace("[chatAvailableGroup]", chatAvailableGroup)
                    }
                } catch (e) {
                    sendConsole("Error handling API [chatAvailableGroup]: "+ e, 3);
                }
                try{
                    if (replyMessage.includes("[paidPromotion]")) {
                        let paidPromotion = JSON.parse(liveDetailResponse).content.paidPromotion;
                        replyMessage = replyMessage.replace("[paidPromotion]", paidPromotion)
                    }
                } catch (e) {
                    sendConsole("Error handling API [paidPromotion]: "+ e, 3);
                }
                try{
                    if (replyMessage.includes("[followDate]")) {
                        console.log(JSON.parse(userProfileCardResponse));
                        if (userProfileCardResponse.includes('"following":{')){
                            let followDate = JSON.parse(userProfileCardResponse).content.streamingProperty.following.followDate;
                            replyMessage = replyMessage.replace("[followDate]", followDate)
                        } else {
                            replyMessage = replyMessage.replace("[followDate]", "not following")
                        }
                    }
                } catch (e) {
                    sendConsole("Error handling API [followDate]: "+ e, 3);
                }

                await sendMessage(replyMessage);

                if (config.saveLog) {
                    saveLog(`COMMAND / ${commandsDataItem.command} / ${commandsDataItem.reply}`);
                }
            }
        }
    } catch (e) {
        sendConsole(e, 3);
    }
}

/**
 * 
 * @param {string} message Text to send in chat
 */
async function sendMessage(message) {
    if (isLoggedIn){
        let textareaElement = await driver.findElement(By.css('[class^="live_chatting_input_input"]'));
        await driver.wait(until.elementIsVisible(textareaElement));
        await textareaElement.click();
        await driver.sleep(50);
        await driver.actions().sendKeys(message).perform();
        await driver.sleep(50);
        await driver.actions().sendKeys(Key.ENTER).perform();
    } else {
        sendConsole("User should be logged in to send message", 3)
    }
}

/**
 * 
 * @param {string} data Text to save
 */
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
            sendConsole(e, 3);
        }
    });
}

async function injectScriptLoop(url) {
    let currentUrl = '';

    currentUrl = await driver.getCurrentUrl();
    if (currentUrl === url && shouldInject) {
        shouldInject = false;
        const webSocketListener = await fs.readFile('./modules/webSocketListener.js', 'utf-8');
        await driver.executeScript(webSocketListener);
        sendConsole('Injected webSocketListener.js', 1);
    } else {
        await driver.sleep(100);
    }

    if (currentUrl != url) {
        shouldInject = true;
    }
}

const MAX_TABS = 5;
let apiDriver;
async function fetchApi(apiUrl) {
    try {
        let apiOptions;
        if (!apiDriver) {
            apiOptions = new chrome.Options();
            apiOptions.addArguments(
                `user-data-dir=${__dirname}/apiBrowserData`,
                "--disable-gpu",
                "window-size=1920x1080",
                "lang=ko_KR",
                "--host-resolver-rules=MAP livecloud.pstatic.net 127.0.0.1, MAP livecloud.akamaized.net 127.0.0.1"
            );

            apiOptions.headless().addArguments('console', '--log-level=3');

            apiDriver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(apiOptions)
                .build();
        }

        await apiDriver.executeScript("window.open('', '_blank');");

        const handles = await apiDriver.getAllWindowHandles();

        while (handles.length > MAX_TABS) {
            await apiDriver.switchTo().window(handles[0]);
            await apiDriver.close();
            handles.shift();
        }

        await apiDriver.switchTo().window(handles[handles.length - 1]);
        await apiDriver.get(apiUrl);
        await apiDriver.wait(until.urlContains(apiUrl), 10000);
        const preElement = await apiDriver.findElement(By.tagName('pre'));
        const preElementContent = await preElement.getText();
        return preElementContent;
    } catch (e) {
        sendConsole('Error in fetchApi:\n' + e, 3);
    }
}

function getTimeDifference(timestamp) {
    const inputDate = new Date(timestamp);
    const currentDate = new Date();

    const timeDifference = currentDate - inputDate;

    const hours = Math.floor(timeDifference / (1000 * 60 * 60));
    const minutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000);

    const formattedTime = `${hours} hours ${minutes} minutes ${seconds} seconds`;

    return formattedTime;
}

async function copyDirectory(source, destination) {
  const files = await fs.readdir(source);

  try {
    await fs.mkdir(destination);
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }

  for (const file of files) {
    const sourcePath = path.join(source, file);
    const destPath = path.join(destination, file);

    const stats = await fs.stat(sourcePath);
    if (stats.isDirectory()) {
      await copyDirectory(sourcePath, destPath);
    } else {
      await fs.copyFile(sourcePath, destPath);
    }
  }
}

runBot();