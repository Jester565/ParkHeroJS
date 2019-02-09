var rp = require('request-promise-native');
var rides = require('../dis/Ride');

const util = require('util');
const fs = require('fs');
const readFileAsync = util.promisify(fs.readFile);

jest.mock('request-promise-native');

test('get ride times', async () => {
    var disneylandRespText = await readFileAsync(__dirname + "/RideTimeDisneylandResp.json", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(JSON.parse(disneylandRespText));
    }));
    var caRespText = await readFileAsync(__dirname + "/RideTimeCaliforniaAdventuresResp.json", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(JSON.parse(caRespText));
    }));
    var rideTimes = await rides.getRideTimes('', [ 330339, 336894 ], 'America/Los_Angeles');
    var rideFound = false;
    for (var rideTime of rideTimes) {
        if (rideTime.id == 353295) {
            expect(rideTime.waitMins).toBe(35);
            expect(rideTime.name).toBe("Big Thunder Mountain Railroad");
            expect(rideTime.status).toBe("Operating");
            expect(rideTime.fastPassTime.format("HH:mm")).toBe("12:20");
            rideFound = true;
            break;
        }
    }
    expect(rideFound).toBeTruthy();
});

test('get ride infos', async () => {
    var respText = await readFileAsync(__dirname + "/RideInfosResp.xml", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(respText);
    }));
    var rideInfos = await rides.getRideInfos(1000);
    fs.writeFileSync('./GetRideInfosRet.json', JSON.stringify(rideInfos, null, '\t'))
});