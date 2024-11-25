const {Builder, By, Key, until, promise} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const webSocket = require('isomorphic-ws');
const fs = require('fs').promises;
const https = require('https');
const logger = require('./modules/colorfulLogger');

process.title = 'CHZZK ChatBot';

let driver;
let config = {};
let isConnected = false;
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
let userNickname = "";
let ws;
let reconnectCount = 0;

async function loadConfig() {
    try {
        logger.info('Reading config file...');
        const data = await fs.readFile('config.json', 'utf8');
        config = JSON.parse(data);
    } catch (e) {
        logger.error('Error reading config file: ' + e);
        config = {};
    }
}

async function loadCommands() {
    try {
        const data = await fs.readFile('commands.json', 'utf8');
        commandsData = JSON.parse(data);
        for (const commandData of commandsData) {
            await logger.info(`Command ${commandData.command} has been loaded!`);
        }
    } catch (e) {
        logger.error('Error reading commands file: ' + e);
    }
}

async function runBot() {
    logger.term('Type "help" for command list.');
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
            //logger.info('Found channel Id: ' + channelId);
        } else {
            logger.error('Error getting channelId, wrong URL?');
        }
        await checkLoginStatus();
    } catch (e) {
        logger.error(e);
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
        connectWebSocket();
        return;
    } else {
        if (currentUrl == url) {
            logger.warn('User not logged in, please log in');
            currentUrl = 'https://nid.naver.com/nidlogin.login?url=' + url;
            await driver.get('https://nid.naver.com/nidlogin.login?url=' + url);
        }
        //logger.info('Waiting 5 seconds for website to load');
        await driver.sleep(500);
        checkLoginStatus();
    }
}

async function onMessageReceiveEvent(data) {
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
            //logger.debug(`${nickname} (${msgTypeCode}), ${message}`, 'Message');

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

                if (message.startsWith(commandsDataItem.command) && msgTypeCode == commandsDataItem.msgTypeCode && nickname != userNickname) {
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

                    const replacePlaceholders = (str) => {
                        return str.replace(/\[nickname\]/g, nickname)
                                  .replace(/\[channelName\]/g, JSON.parse(channelProfileCardResponse).content.nickname)
                                  .replace(/\[message\]/g, message)
                                  .replace(/\[title\]/g, JSON.parse(liveStatusResponse).content.liveTitle)
                                  .replace(/\[uptime\]/g, calculateUptime(JSON.parse(liveDetailResponse).content.livePlaybackJson))
                                  .replace(/\[concurrentUserCount\]/g, JSON.parse(liveStatusResponse).content.concurrentUserCount)
                                  .replace(/\[accumulateCount\]/g, JSON.parse(liveStatusResponse).content.accumulateCount)
                                  .replace(/\[categoryType\]/g, JSON.parse(liveStatusResponse).content.categoryType)
                                  .replace(/\[liveCategory\]/g, JSON.parse(liveStatusResponse).content.liveCategory)
                                  .replace(/\[liveCategoryValue\]/g, JSON.parse(liveStatusResponse).content.liveCategoryValue)
                                  .replace(/\[chatActive\]/g, JSON.parse(liveDetailResponse).content.chatActive)
                                  .replace(/\[chatAvailableGroup\]/g, JSON.parse(liveDetailResponse).content.chatAvailableGroup)
                                  .replace(/\[paidPromotion\]/g, JSON.parse(liveDetailResponse).content.paidPromotion)
                                  .replace(/\[followDate\]/g, getFollowDate(userProfileCardResponse));
                    };

                    replyMessage = replacePlaceholders(replyMessage);

                    await sendMessage(replyMessage);
                    //logger.debug(replyMessage, 'Reply');

                    if (config.saveLog) {
                        saveLog(`COMMAND / ${commandsDataItem.command} / ${commandsDataItem.reply}`);
                    }
                }
            }
        } else if (data.cmd == 10100) {
            sid = data.bdy.sid;
        }
    } catch (e) {
        logger.error(`Error: ${e.message}`);
    }

    function calculateUptime(livePlaybackJson) {
        try {
            const parsedJson = JSON.parse(livePlaybackJson);

            if (parsedJson.live && parsedJson.live.start && parsedJson.live.status == 'STARTED') {
                const startTimestamp = parsedJson.live.start;
                const uptime = getTimeDifference(startTimestamp);
                return uptime;
            } else if (parsedJson.live.status == 'ENDED') {
                return 'OFFLINE';
            }
        } catch (e) {
            logger.error(`Error handling API [uptime]: ${e}`);
            return '';
        }
    }

    function getFollowDate(userProfileCardResponse) {
        try {
            const streamingProperty = JSON.parse(userProfileCardResponse).content.streamingProperty;
            const followDate = streamingProperty.following ? streamingProperty.following.followDate : "not following";
            return followDate;
        } catch (e) {
            logger.error("Error handling API [followDate]: " + e);
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
        logger.warn("User should be logged in to send message")
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
            logger.error(e);
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
            logger.error(`Failed to get NID_AUT cookie: ${e.message.split('\n')[0]}`);
        }
        try {
            NID_SES = await driver.manage().getCookie('NID_SES');
            NID_SES = NID_SES.value;
        } catch (e) {
            logger.error(`Failed to get NID_SES cookie: ${e.message.split('\n')[0]}`);
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

    let formattedTime = `${hours} hours ${minutes} minutes ${seconds} seconds`;
    const uptimeText = config.uptimeText;
    try {
        formattedTime = uptimeText.replace("%hours%", hours);
        formattedTime = formattedTime.replace("%minutes%", minutes);
        formattedTime = formattedTime.replace("%seconds%", seconds);
    } catch (e) {
        logger.error(`Error fetching uptimeText from config: ${e}`);
    }

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
    userNickname = await JSON.parse(userStatusResponse).content.nickname;
    let accessToken = await JSON.parse(accessTokenResponse).content.accessToken;
    let myUserIdHash = await JSON.parse(userStatusResponse).content.userIdHash;

    logger.info(`User logged in to ${userNickname}`);

    const serverId = Math.floor(Math.random()*5+1);
    ws = new webSocket(`wss://kr-ss${serverId}.chat.naver.com/chat`);

    ws.onopen = async () => {
        isConnected = true;
        startPingTimer();
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
        const liveDetailResponse = await fetchApi(`https://api.chzzk.naver.com/service/v1/channels/${channelId}/live-detail`);
        const channelName = JSON.parse(liveDetailResponse).content.channel.channelName;
        logger.info(`Connected to server ${serverId} (${channelName})`);
    }

    ws.onclose = function onClose() {
        logger.warn('Disconnected from server');
        isConnected = false;
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
                    logger.info(`Reconnecting to server... (${reconnectCount} ${reconnectCount == 1 ? 'time' : 'times'})`);
                    connectWebSocket();
                }
                break;
        }
    };

    ws.onmessage = function onMessage(data) {
        onMessageReceiveEvent(data.data);
    };
}

async function startPingTimer() {
    for (;;) {
        if (!isConnected) {
            break;
        }
        await pingTimer();
        await new Promise(resolve => setTimeout(resolve, 20000));
    }
}

async function pingTimer() {
    if (isConnected){
        const data = JSON.stringify({
            ver: "2",
            cmd: 10000
        })
        ws.send(data);
    }
}

runBot();