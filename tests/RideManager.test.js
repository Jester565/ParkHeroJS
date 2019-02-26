var config = require('./config');

var AWS = require('aws-sdk');
AWS.config.update({region: config.region});

var s3 = new AWS.S3();

var bucket = config.s3.bucket;

var moment = require('moment-timezone');

const util = require('util');

const fs = require('fs');
const readFileAsync = util.promisify(fs.readFile);

const mysql = require('mysql'); // or use import if you use TS

var connection = null;
connection = mysql.createConnection({
    host: config.mysql.host,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    port: config.mysql.port
});
const query = util.promisify(connection.query).bind(connection);

var imgUploader = require('../core/ImageUploader');
var rides = require('../dis/Ride');
var request = require('request');

jest.mock('../core/ImageUploader');
jest.mock('../dis/Ride');
jest.mock('request');

var rideManager = require('../core/RideManager');

beforeAll(async () => {
    try {
        await query(`CREATE TABLE IF NOT EXISTS Resorts (id int(11), name varchar(50), zipcode int(11), longitude decimal(9, 5), latitude decimal(9,5), timezone varchar(50), PRIMARY KEY(id))`);
        await query(`CREATE TABLE IF NOT EXISTS Parks (id int(11), name varchar(50), resortID int(11), urlName varchar(100), iconUrl varchar(255), PRIMARY KEY(id), FOREIGN KEY(resortID) REFERENCES Resorts(id))`);
        await query(`CREATE TABLE IF NOT EXISTS Rides (id int(11), parkID int(11), name varchar(100), imgUrl varchar(255), height varchar(50), labels varchar(255), land varchar(100), valid tinyint(1), PRIMARY KEY (id), FOREIGN KEY (parkID) REFERENCES Parks(id))`);
        await query(`CREATE TABLE IF NOT EXISTS RideTimes (rideID int(11), dateTime DATETIME, waitMins int(4), fastPassTime TIME, status varchar(50), PRIMARY KEY (rideID, dateTime), FOREIGN KEY(rideID) REFERENCES Rides(id))`);
        await query(`CREATE TABLE IF NOT EXISTS LatestRideTimes (rideID int(11), dateTime DATETIME, waitMins int(4), fastPassTime TIME, status varchar(50), lastStatusRange TIME, lastStatusTime DATETIME, lastChangeTime DATETIME, lastChangeRange TIME, PRIMARY KEY(rideID), FOREIGN KEY (rideID) REFERENCES Rides(id))`);
        
        await query(`DELETE FROM LatestRideTimes`);
        await query(`DELETE FROM RideTimes`);
        await query(`DELETE FROM Rides`);
        await query(`DELETE FROM Resorts`);
        await query(`DELETE FROM Parks`);
        
        await query(`INSERT INTO Resorts VALUES ?`,
            [[[80008297, 'Disneyland', 92802, 33.81011, -117.91897, 'America/Los_Angeles']]]);
        await query(`INSERT INTO Parks VALUES ?`,
            [[[330339, 'Disneyland', 80008297, 'disneyland', 'picUrl'],
            [336894, 'California Adventures', 80008297, 'disney-california-adventure', 'picUrl']]]);
    } catch (e) {
        console.log("ERROR: ", e);
    }
});

test('Add Ride Information', async() => {
    var respText = await readFileAsync(__dirname + "/GetRideInfosRet.json", {encoding: 'utf8'});
    var rideInfos = JSON.parse(respText);
    rides.getRideInfos.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(rideInfos);
    }));
    request.get.mockResolvedValue(fs.createReadStream(__dirname + "/SpaceMountain.jpg"));
    imgUploader.uploadImageStreamOfSizes.mockResolvedValue(new Promise((resolve) => {
        resolve();
    }));
    await rideManager.addRideInformations(80008297, [500, 1000], bucket, null, query);
    var savedRides = await rideManager.getSavedRides(query);
    expect(savedRides.length).toBe(79);
    var found = false;
    for (var savedRide of savedRides) {
        if (savedRide.id == 367495) {
            expect(savedRide.parkID).toBe(330339);
            expect(savedRide.name).toBe("Alice in Wonderland");
            expect(savedRide.imgUrl).toBe("rides/367495");
            expect(savedRide.height).toBe("Any Height");
            expect(savedRide.labels).toBe("Slow Rides, Dark, Loud")
            expect(savedRide.land).toBe("Disneyland Park, Fantasyland");
            found = true;
        }
    }
    expect(found).toBeTruthy();
}, 25000);

test('Add Latest Ride Times', async() => {
    var rideInfos = JSON.parse(await readFileAsync(__dirname + "/GetRideInfosRet.json", {encoding: 'utf8'}));
    rides.getRideInfos.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(rideInfos);
    }));
    request.get.mockResolvedValue(fs.createReadStream(__dirname + "/SpaceMountain.jpg"));
    imgUploader.uploadImageStreamOfSizes.mockResolvedValue(new Promise((resolve) => {
        resolve();
    }));
    await rideManager.addRideInformations(80008297, [500, 1000], bucket, null, query);

    var rideTimes = JSON.parse(await readFileAsync(__dirname + "/GetRideTimesRet.json", {encoding: 'utf8'}));
    for (var rideTime of rideTimes) {
        if (rideTime.fastPassTime != null) {
            rideTime.fastPassTime = moment(rideTime.fastPassTime);
        }
    }
    var updatedRideTimes = await rideManager.getUpdatedRideTimes(rideTimes, query);
    await rideManager.saveLatestRideTimes(updatedRideTimes, 'America/Los_Angeles', query);
    var savedRides = await rideManager.getSavedRides(query);

    var found = false;
    for (var ride of savedRides) {
        if (ride.id == 16514416) {
            expect(ride.waitMins).toBe(75);
            expect(ride.fastPassTime).toBe("16:45:00");
            expect(ride.status).toBe("Operating");
            found = true;
        }
    }
    expect(found).toBeTruthy();

    //Make sure historical ride time runs without crashing
    await rideManager.saveToHistoricalRideTimes(rideTimes, 'America/Los_Angeles', query);
}, 20000);

describe('RideDPs Test', () => {
    test('Get RideDPS', async () => {
        var date = moment('2019-02-25', 'YYYY-MM-DD');
        var rideDPs = await rideManager.getRideDPs(date, 'America/Los_Angeles', async (queryStr) => {
            if (queryStr.indexOf("BatchResults") >= 0) {
                return JSON.parse(await readFileAsync(__dirname + "/BatchResults.json", {encoding: 'utf8'}));
            } else {
                return JSON.parse(await readFileAsync(__dirname + "/RideHistory.json", {encoding: 'utf8'}));
            }
        });
        fs.writeFileSync('./RideDPs.json', JSON.stringify(rideDPs, null, 2));
    });

});

afterEach(async () => {
    await query(`DELETE FROM LatestRideTimes`);
    await query(`DELETE FROM RideTimes`);
    await query(`DELETE FROM Rides`);
});

afterAll(async () => {
    await query(`DROP TABLE LatestRideTimes`);
    await query(`DROP TABLE RideTimes`);
    await query(`DROP TABLE Rides`);
    await query(`DROP TABLE Parks`);
    await query(`DROP TABLE Resorts`);
    connection.end();
});