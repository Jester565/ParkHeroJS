var rp = require('request-promise-native');
var moment = require('moment-timezone');

function intensityToAerisCode(precipitation) {
    if (precipitation <= .001) {
        return 0;
    }
    else if (precipitation < 2.5) {
        return 1;
    }
    else if (precipitation < 7.6) {
        return 2;
    }
    else if (precipitation < 50) {
        return 3;
    }
    return 4;
}

async function getForecast(darkskySecret, coords, tz) {
    var options = {
        method: 'GET',
        uri: 'https://api.darksky.net/forecast/' + darkskySecret + "/" + coords + "?extend=hourly",
        headers: {
            'Accept': 'application/json'
        },
        json: true
    };

    var data = await rp(options);
    var hourlyForecasts = data["hourly"]["data"];
    var result = [];
    for (var forecast of hourlyForecasts) {
        var dateTime = moment.unix(forecast.time).tz(tz);
        var feelsLikeF = Math.round(forecast.apparentTemperature);
        var rainStatus = intensityToAerisCode(forecast.precipIntensity) * 4;
        result.push({
            dateTime: dateTime,
            feelsLikeF: feelsLikeF,
            rainStatus: rainStatus
        });
    }
    return result;
}

module.exports = {
    getForecast: getForecast
};