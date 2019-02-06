var rp = require('request-promise-native');
const util = require('util');
const fs = require('fs');
const readFileAsync = util.promisify(fs.readFile);
const moment = require('moment-timezone');

var weathers = require('../core/Weather');

jest.mock('request-promise-native');

test('weathers', async () => {
    var respText = await readFileAsync(__dirname + "/WeatherResp.json", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(JSON.parse(respText));
    }));
    var forecasts = await weathers.getForecast('', '', "America/Los_Angeles");
    expect(forecasts[0].dateTime.format("YYYY-MM-DD HH:mm")).toBe("2019-02-06 12:00");
    expect(forecasts[0].feelsLikeF).toBe(51);
    expect(forecasts[0].rainStatus).toBe(0);
});