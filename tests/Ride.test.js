var rp = require('request-promise-native');
var rides = require('../dis/Ride');

const util = require('util');
const fs = require('fs');
const readFileAsync = util.promisify(fs.readFile);

jest.mock('request-promise-native');

test('get ride times', async () => {
    var respText = await readFileAsync(__dirname + "/RideTimeResp.json", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(JSON.parse(respText));
    }));
    var rideTimes = await rides.getRideTimes('', '', 'America/Los_Angeles');
    
    var rideFound = false;
    for (var rideTime of rideTimes) {
        if (rideTime.id == 353295) {
            expect(rideTime.waitMins).toBe(30);
            expect(rideTime.name).toBe("Big Thunder Mountain Railroad");
            expect(rideTime.status).toBe("Operating");
            expect(rideTime.fastPassTime.format("HH:mm")).toBe("15:05");
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
    var rideInfos = await rides.getRideInfos(1000, 0);
    console.log(JSON.stringify(rideInfos, null, '\t'));
});