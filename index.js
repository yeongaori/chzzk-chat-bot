const {Builder, By, Key, until, promise} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const WebSocket = require('isomorphic-ws');
const fs = require('fs').promises;
const https = require('https');
const { readSync } = require('fs');
const { profile } = require('console');

process.title = 'CHZZK ChatBot';

let driver;
let config = {};
let url = "";
let channelId = "";
let sid = "";
let chatChannelId = "";
let streamingChannelId = "";
let commandsData = [];
let isLoggedIn = false;
let shouldGetCookie = true;
let NID_AUT = "";
let NID_SES = "";
let ws;
let reconnectCount = 0;

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
            "console",
            "--log-level=3"
        )
        .excludeSwitches("enable-logging")

        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        url = config.url;
        await driver.get(url);

        channelId = url.split('chzzk.naver.com/live/')[1]?.split('/')[0];
        if (channelId) {
            sendConsole('Found channel Id: ' + channelId, 1);
        } else {
            sendConsole('Error getting channelId, wrong URL?', 3);
        }
        await checkLoginStatus();
    } catch (e) {
        sendConsole(e, 3);
    }
}

async function checkLoginStatus() {
    let currentUrl = '';
    currentUrl = await driver.getCurrentUrl();
    isLoggedIn = false;
    if (currentUrl == url) {
        try {
            await driver.manage().getCookie('NID_AUT');
            isLoggedIn = true;
        } catch (e) {
            isLoggedIn = false;
        }
    }

    if (isLoggedIn) {
        sendConsole('User logged in', 1);
        connectWebSocket();
        return;
    } else {
        if (currentUrl == url) {
            sendConsole('User not logged in, please log in', 2);
            currentUrl = 'https://nid.naver.com/nidlogin.login?url=' + url;
            await driver.get('https://nid.naver.com/nidlogin.login?url=' + url);
        }
        //sendConsole('Waiting 5 seconds for website to load', 0);
        await driver.sleep(500);
        checkLoginStatus();
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

async function handleMessage(data) {
    try {
        data = JSON.parse(data);
        if (data.cmd == 93101) {
            const bdyData = data.bdy[0];
            const profileData = JSON.parse(bdyData.profile);
            const extrasData = JSON.parse(bdyData.extras);
            const nickname = profileData.nickname;
            const userId = profileData.userIdHash;
            const message = bdyData.msg;
            const msgTypeCode = bdyData.msgTypeCode;
            streamingChannelId = extrasData.streamingChannelId;

            // Log message details
            // console.log(data);
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
                    //replyMessage = "nickname: [nickname] / channelName: [channelName] / message: [message] / title: [title] / uptime: [uptime] / concurrentUserCount: [concurrentUserCount] / accumulateCount: [accumulateCount] / categoryType: [categoryType] / liveCategory: [liveCategory] / liveCategoryValue: [liveCategoryValue] / chatActive: [chatActive] / chatAvailableGroup: [chatAvailableGroup] / paidPromotion: [paidPromotion] / followDate: [followDate]\n";

                    // Fetch necessary data
                    const [liveDetailResponse, liveStatusResponse] = await Promise.all([
                        fetchApi(`https://api.chzzk.naver.com/service/v1/channels/${channelId}/live-detail`),
                        fetchApi(`https://api.chzzk.naver.com/polling/v1/channels/${channelId}/live-status`),
                    ]);
                    chatChannelId = await JSON.parse(liveDetailResponse).content.chatChannelId;
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
                    //sendConsole(replyMessage, 'Reply');

                    if (config.saveLog) {
                        saveLog(`COMMAND / ${commandsDataItem.command} / ${commandsDataItem.reply}`);
                    }
                }
            }
        } else if (data.cmd == 10100) {
            sid = data.bdy.sid;
        }
    } catch (e) {
        sendConsole(`Error: ${e.message}`, 3);
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
        const data = JSON.stringify({
            ver: "2",
            cmd: 3101,
            svcid: "game",
            cid: chatChannelId,
            sid: sid,
            retry: false,
            bdy: {
                msg: message,
                msgTypeCode: 1,
                extras: JSON.stringify({
                    chatType: 'STREAMING',
                    osType: 'PC',
                    streamingChannelId: streamingChannelId,
                    emojis: ''
                }),
                msgTime: Date.now(),
            },
            tid: 3
        })
        ws.send(data);
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

async function getAuthCookie() {
    let currentUrl = '';

    currentUrl = await driver.getCurrentUrl();
    if (currentUrl === url && shouldGetCookie && isLoggedIn) {
        shouldGetCookie = false;

        try {
            NID_AUT = await driver.manage().getCookie('NID_AUT');
            NID_AUT = NID_AUT.value;
        } catch (e) {
            sendConsole(`Failed to get NID_AUT cookie: ${e.message.split('\n')[0]}`, 2)
        }
        try {
            NID_SES = await driver.manage().getCookie('NID_SES');
            NID_SES = NID_SES.value;
        } catch (e) {
            sendConsole(`Failed to get NID_SES cookie: ${e.message.split('\n')[0]}`, 2)
        }
    } else {
        await driver.sleep(100);
    }

    if (currentUrl != url) {
        shouldGetCookie = true;
    }
}

function fetchApi(apiUrl) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'Cookie': `NID_AUT=${NID_AUT}; NID_SES=${NID_SES};`
        }
      };
  
      https.get(apiUrl, options, (response) => {
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

async function connectWebSocket() {
    await getAuthCookie();
    const liveDetailResponse = await fetchApi(`https://api.chzzk.naver.com/service/v1/channels/${channelId}/live-detail`);
    chatChannelId = await JSON.parse(liveDetailResponse).content.chatChannelId;
    const [accessTokenResponse, userStatusResponse] = await Promise.all([
        fetchApi(`https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${chatChannelId}&chatType=STREAMING`),
        fetchApi(`https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus`)
    ]);
    let accessToken = await JSON.parse(accessTokenResponse).content.accessToken;
    let myUserIdHash = await JSON.parse(userStatusResponse).content.userIdHash;

    const serverId = Math.floor(Math.random()*5+1);
    ws = new WebSocket(`wss://kr-ss${serverId}.chat.naver.com/chat`);

    ws.onopen = () => {
        sendConsole(`Connected to server ${serverId}`, 1);
        driver.quit();
        const data = JSON.stringify({
            ver: "2",
            cmd: 100,
            svcid: "game",
            cid: chatChannelId,
            bdy: {
                uid: myUserIdHash,
                devType: 2001,
                accTkn: accessToken,
                auth: "SEND",
            },
            tid: 1
        })
        ws.send(data);
    }

    ws.onclose = function onClose() {
        sendConsole('Disconnected from server', 2);
        switch (config.reconnect) {
            case -1:
                resolve;
                break;
            case 0:
                connectWebSocket();
                break;
            default:
                reconnectCount += 1;
                if (reconnectCount <= config.reconnect){
                    sendConsole(`Reconnecting to server... (${reconnectCount} ${reconnectCount == 1 ? 'time' : 'times'})`, 1);
                    connectWebSocket();
                }
                break;
        }
    };

    ws.onmessage = function onMessage(data) {
        handleMessage(data.data);
    };
}

runBot();