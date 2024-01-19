const {Builder, By, Key, until} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs').promises;
const https = require('https');

process.title = 'CHZZK ChatBot';

let driver;
let config = {};
let channelId = "";
let commandsData = [];
let isLoggedIn = false;
let shouldInject = true;
let NID_AUT = "";
let NID_SES = "";

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

async function runBot() {
    try {
        await loadConfig();
        await loadCommands();

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

        // Log message details
        // console.log(wsData);
        // sendConsole(`${nickname} (${msgTypeCode}), ${message}`, 'Message');

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
                    // Command is on cooldown, skip
                    continue;
                }
            }

            cooldowns.set(commandKey, Date.now());

            if (message.startsWith(commandsDataItem.command) && msgTypeCode === commandsDataItem.msgTypeCode) {
                let replyMessage = commandsDataItem.reply;
                replyMessage = "nickname: [nickname] / channelName: [channelName] / message: [message] / title: [title] / uptime: [uptime] / concurrentUserCount: [concurrentUserCount] / accumulateCount: [accumulateCount] / categoryType: [categoryType] / liveCategory: [liveCategory] / liveCategoryValue: [liveCategoryValue] / chatActive: [chatActive] / chatAvailableGroup: [chatAvailableGroup] / paidPromotion: [paidPromotion] / followDate: [followDate]\n";

                // Fetch necessary data
                const [liveDetailResponse, liveStatusResponse] = await Promise.all([
                    fetchApi(`https://api.chzzk.naver.com/service/v1/channels/${channelId}/live-detail`),
                    fetchApi(`https://api.chzzk.naver.com/polling/v1/channels/${channelId}/live-status`),
                ]);
                const chatChannelId = await JSON.parse(liveDetailResponse).content.chatChannelId;
                const [channelProfileCardResponse, userProfileCardResponse] = await Promise.all([
                    fetchApi(`https://comm-api.game.naver.com/nng_main/v1/chats/${chatChannelId}/users/${channelId}/profile-card?chatType=STREAMING`),
                    fetchApi(`https://comm-api.game.naver.com/nng_main/v1/chats/${chatChannelId}/users/${userId}/profile-card?chatType=STREAMING`)
                ]);

                replyMessage = replyMessage.replace("[nickname]", nickname);
                replyMessage = replyMessage.replace("[channelName]", JSON.parse(channelProfileCardResponse).content.nickname);
                replyMessage = replyMessage.replace("[message]", message);
                replyMessage = replyMessage.replace("[title]", JSON.parse(liveStatusResponse).content.liveTitle);
                replyMessage = replyMessage.replace("[uptime]", calculateUptime(JSON.parse(liveDetailResponse).content.livePlaybackJson));
                replyMessage = replyMessage.replace("[concurrentUserCount]", JSON.parse(liveStatusResponse).content.concurrentUserCount);
                replyMessage = replyMessage.replace("[accumulateCount]", JSON.parse(liveStatusResponse).content.accumulateCount);
                replyMessage = replyMessage.replace("[categoryType]", JSON.parse(liveStatusResponse).content.categoryType);
                replyMessage = replyMessage.replace("[liveCategory]", JSON.parse(liveStatusResponse).content.liveCategory);
                replyMessage = replyMessage.replace("[liveCategoryValue]", JSON.parse(liveStatusResponse).content.liveCategoryValue);
                replyMessage = replyMessage.replace("[chatActive]", JSON.parse(liveDetailResponse).content.chatActive);
                replyMessage = replyMessage.replace("[chatAvailableGroup]", JSON.parse(liveDetailResponse).content.chatAvailableGroup);
                replyMessage = replyMessage.replace("[paidPromotion]", JSON.parse(liveDetailResponse).content.paidPromotion);
                replyMessage = replyMessage.replace("[followDate]", getFollowDate(userProfileCardResponse));

                // Send the modified replyMessage
                await sendMessage(replyMessage);

                if (config.saveLog) {
                    saveLog(`COMMAND / ${commandsDataItem.command} / ${commandsDataItem.reply}`);
                }
            }
        }
    } catch (error) {
        sendConsole(`Error: ${error.message}`, 3);
    }


    function calculateUptime(livePlaybackJson) {
        try {
            const startTimestamp = JSON.parse(livePlaybackJson).live.start;
            const uptime = getTimeDifference(startTimestamp);
            return uptime;
        } catch (e) {
            sendConsole(`Error handling API [uptime]: ${e}`, 3);
            return '';
        }
    }

    function getFollowDate(userProfileCardResponse) {
        try {
            const streamingProperty = JSON.parse(userProfileCardResponse).content.streamingProperty;
            const followDate = streamingProperty.following ? streamingProperty.following.followDate : "not following";
            return followDate;
        } catch (e) {
            sendConsole("Error handling API [followDate]: " + e, 3);
            return '';
        }
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
        NID_AUT = await driver.manage().getCookie('NID_AUT');
        NID_SES = await driver.manage().getCookie('NID_SES');
        sendConsole('Injected webSocketListener.js', 1);
    } else {
        await driver.sleep(100);
    }

    if (currentUrl != url) {
        shouldInject = true;
    }
}

function fetchApi(url) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'Cookie': `NID_AUT=${NID_AUT.value}; NID_SES=${NID_SES.value};`
        }
      };
  
      https.get(url, options, (response) => {
        let data = '';
  
        // A chunk of data has been received
        response.on('data', (chunk) => {
          data += chunk;
        });
  
        // The whole response has been received
        response.on('end', () => {
          resolve(data);
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
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

runBot();
