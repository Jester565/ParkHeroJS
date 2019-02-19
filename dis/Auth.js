var rp = require('request-promise-native');
var querystring = require('querystring');


//The maximum amount of milliseconds a token must remain valid for us to finish our work
var MAX_RUN_MILLIS = 15000;
var REFRESH_TTL_MILLIS = 30 * 60 * 1000;  //30 minutes

async function refreshAPIToken() {
    var body = {
        'grant_type': 'assertion',
        'assertion_type': 'public',
        'client_id': 'TPR-DLR_COPY.AND-PROD'
    };
    var options = {
        method: 'POST',
        uri: 'https://authorization.go.com/token',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: querystring.stringify(body),
        json: true
    };
    var respData = await rp(options);
    if (respData['access_token'] == null) {
        throw "Unexpected body on requestAPIToken: " + JSON.stringify(respData);
    }
    return respData['access_token'];
}

async function refreshAccessToken(refreshToken, apiToken) {
    var body = {
        "refreshToken": refreshToken 
    } ;
    var options = {
        method: 'POST',
        uri: 'https://api.wdpro.disney.go.com/profile-service/v4/clients/TPR-DLR_COPY.AND-PROD/guests/login/refreshToken',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'BEARER ' + apiToken
        },
        body: body,
        json: true
    };
    var respData = await rp(options);
    var accessToken = respData["data"]["token"]["access_token"];
    var disID = respData["data"]["token"]["swid"];
    var loginTime = respData["data"]["token"]["initial_grant_in_chain_time"];
    var loginTTL = respData["data"]["token"]["refresh_ttl"];
    return {
        "accessToken": accessToken, 
        "apiToken": apiToken,
        "refreshToken": refreshToken,
        "disID": disID, 
        "loginTime": loginTime, 
        "loginTTL": loginTTL,
        "refreshTime": Date.now()
    };
}

async function refreshTokens(refreshToken) {
    var apiToken = await refreshAPIToken();
    var accessTokenData = await refreshAccessToken(refreshToken, apiToken);
    return accessTokenData;
}

async function refreshAPIKey(apiToken) {
    var options = {
        method: 'POST',
        uri: 'https://api.wdpro.disney.go.com/profile-service/v4/clients/TPR-DLR_COPY.AND-PROD/api-key',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'BEARER ' + apiToken
        },
        resolveWithFullResponse: true
    };
    var res = await rp(options);
    return res.headers["api-key"];
}

async function refreshRefreshToken(username, password, apiKey, apiToken) {
    var body = {
        'loginValue': username,
        'password': password
    };
    var options = {
      method: 'POST',
      uri: 'https://api.wdpro.disney.go.com/profile-service/v4/clients/TPR-DLR_COPY.AND-PROD/guests/login',
      headers: {
          'accept': 'application/json;version=5',
          'Content-Type': 'application/json',
          'x-authorization-gc': 'APIKEY ' + apiKey,
          'Authorization': 'BEARER ' + apiToken,
          'Accept-Encoding': 'gzip'
      },
      body: body,
      json: true
    };
    
    var respData = await rp(options);
    return respData["data"]["token"]["refresh_token"];
}

async function getAccessToken(lastTokenInfo) {
    var loginTTLMillis = lastTokenInfo.loginTTL * 1000;
    var lastLoginMillis = lastTokenInfo.loginTime;
    var loginTimeDif = Date.now() - lastLoginMillis;
    if (loginTimeDif + MAX_RUN_MILLIS >= loginTTLMillis) {
        throw "Login token expired";
    }
    var lastRefreshMillis = lastTokenInfo.refreshTime;
    var refreshTimeDif = Date.now() - lastRefreshMillis;
    if (refreshTimeDif + MAX_RUN_MILLIS >= REFRESH_TTL_MILLIS) {
        var tokenInfo = await refreshTokens(lastTokenInfo["refreshToken"]);
        return tokenInfo;
    }
    return lastTokenInfo;
}

async function login(username, password) {
    var apiToken = await refreshAPIToken();
    var apiKey = await refreshAPIKey(apiToken);
    var refreshToken = await refreshRefreshToken(username, password, apiKey, apiToken);
    var tokenInfo = await refreshAccessToken(refreshToken, apiToken);
    return tokenInfo;
}

module.exports = {
    refreshAPIToken: refreshAPIToken,
    getAccessToken: getAccessToken,
    login: login
};