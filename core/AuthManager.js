var auth = require('../dis/Auth');
var moment = require('moment');

async function _storeAccessTokenInfo(accessToken, apiToken, lastRefresh, disID, query) {
    await query(`UPDATE DisTokens SET token=?, accessToken=?, lastRefresh=?, disId=? WHERE userId=?`,
        [apiToken, accessToken, lastRefresh, disID]);
}

async function _storeLoginTokenInfo(credID, accessToken, refreshToken, lastLogin, loginTTL, apiToken, lastRefresh, disID, query) {
    await query(`INSERT INTO DisTokens VALUES ? 
        ON DUPLICATE KEY UPDATE accessToken=?, refreshToken=?, lastLogin=?, loginTTL=?, apiToken=?, lastRefresh=?, disID=?`,
        [[[credID, apiToken, accessToken, refreshToken, lastRefresh, lastLogin, loginTTL, disID]], 
        accessToken, refreshToken, lastLogin, loginTTL, apiToken, lastRefresh, disID]);
}

async function getAccessToken(credID, username, password, query) {
    var tokenResults = await query(`SELECT token AS apiToken, accessToken, refreshToken, lastRefresh AS refreshTime, lastLogin AS loginTime, loginTTL, disId AS disID
        FROM DisTokens WHERE userId=?`, [credID]);
    if (tokenResults.length == 0) {
        throw "CredID has never logged in";
    }
    var lastTokenInfo = tokenResults[0];
    var tokenInfo = null;
    try {
        tokenInfo = await auth.getAccessToken(lastTokenInfo);
        if (tokenInfo != lastTokenInfo) {
            await _storeAccessTokenInfo(tokenInfo.accessToken, tokenInfo.apiToken, tokenInfo.refreshTime, tokenInfo.disID, query);
        }
    } catch (e) {
        //If getAccessToken fails, we need to login
        tokenInfo = await login(credID, username, password, query);
    }
    return tokenInfo;
}

async function getAPIToken(query) {
    var tokenResults = await query(`SELECT token AS apiToken, lastRefresh AS lastRefresh FROM DisApiTokens WHERE id=0`);
    
    if (tokenResults.length == 0 || Date.now() - tokenResults[0].lastRefresh >= auth.REFRESH_TTL_MILLIS) {
        tokenResults.apiToken = await auth.refreshAPIToken();
        
        await query(`INSERT INTO DisApiTokens VALUES ? ON DUPLICATE KEY UPDATE token=?, lastRefresh=?`, [[[1, tokenResults.apiToken, Date.now()]], tokenResults.apiToken, Date.now()]);
    }
    return tokenResults.apiToken;
}

async function login(credID, username, password, query) {
    var tokenInfo = await auth.login(username, password);
    await _storeLoginTokenInfo(credID, tokenInfo.accessToken, tokenInfo.refreshToken, tokenInfo.loginTime, 
        tokenInfo.loginTTL, tokenInfo.apiToken, tokenInfo.refreshTime, tokenInfo.disID, query);
    return tokenInfo;
}

module.exports = {
    getAccessToken: getAccessToken,
    getAPIToken: getAPIToken,
    login: login
};