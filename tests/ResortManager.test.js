var config = require('./config');

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

var schedules = require('../dis/Schedule');
var weathers = require('../core/Weather');

var resortManager = require('../core/ResortManager');

jest.mock('../dis/Schedule');
jest.mock('../core/Weather');

beforeAll(async () => {
    try {
        await query(`CREATE TABLE IF NOT EXISTS Resorts (id int(11), name varchar(50), zipcode int(11), longitude decimal(9, 5), latitude decimal(9,5), timezone varchar(50), PRIMARY KEY(id))`);
        await query(`CREATE TABLE IF NOT EXISTS Parks (id int(11), name varchar(50), resortID int(11), urlName varchar(100), iconUrl varchar(255), PRIMARY KEY(id), FOREIGN KEY(resortID) REFERENCES Resorts(id))`);
        await query(`CREATE TABLE IF NOT EXISTS ParkSchedules (date DATE, parkID int(11), openTime TIME, closeTime TIME, magicHourStartTime TIME, magicHourEndTime TIME, crowdLevel int(1), blockLevel int(1), PRIMARY KEY(date, parkID), FOREIGN KEY(parkID) REFERENCES Parks(id))`); 
        await query(`CREATE TABLE IF NOT EXISTS Events (name varchar(150), resortID int(11), imgUrl varchar(255), location varchar(100), PRIMARY KEY(name, resortID), FOREIGN KEY (resortID) REFERENCES Resorts(id))`);
        await query(`CREATE TABLE IF NOT EXISTS EventTimes (eventName varchar(150), resortID int(11), dateTime DATETIME, PRIMARY KEY(eventName, resortID, dateTime), FOREIGN KEY(eventName, resortID) REFERENCES Events(name, resortID))`);
        await query(`CREATE TABLE IF NOT EXISTS HourlyWeather (resortID int(11), dateTime DATETIME, rainStatus int(11), feelsLikeF int(11), PRIMARY KEY(resortID, dateTime), FOREIGN KEY(resortID) REFERENCES Resorts(id))`);
        await query(`DELETE FROM EventTimes`);
        await query(`DELETE FROM Events`);
        await query(`DELETE FROM HourlyWeather`);
        await query(`DELETE FROM ParkSchedules`);
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

test('Add / Get Schedules', async() => {
    var respText = await readFileAsync(__dirname + "/AllSchedulesRet.json", {encoding: 'utf8'});
    schedules.getAllSchedules.mockResolvedValueOnce(new Promise((resolve) => {
        var resp = JSON.parse(respText);
        var momentify = (obj, key) => {
            obj[key] =  moment(obj[key]).tz('America/Los_Angeles');
        }
        for (var monthSchedule of resp) {
            for (var day in monthSchedule) {
                var daySchedule = monthSchedule[day];
                for (var parkName of ["disneyland", "disney-california-adventure"]) {
                    var parkSchedule = daySchedule[parkName];
                    if (parkSchedule.operatingHours != null) {
                        momentify(parkSchedule.operatingHours, "startTime");
                        momentify(parkSchedule.operatingHours, "endTime");
                    }
                    if (parkSchedule.magicHours != null) {
                        momentify(parkSchedule.magicHours, "startTime");
                        momentify(parkSchedule.magicHours, "endTime");
                    }
                }
                if (daySchedule.events != null) {
                    for (var event of daySchedule.events) {
                        if (event.operatingTimes != null) {
                            var times = [];
                            for (var opTimeStr of event.operatingTimes) {
                                times.push(moment(opTimeStr).tz('America/Los_Angeles'));
                            }
                            event.operatingTimes = times;
                            //console.log(typeof event.operatingHours[0]);
                        }
                    }
                }
            }
        }
        resolve(resp);
    }));
    await resortManager.addSchedules(80008297, query);
    var parkSchedules = await resortManager.getSchedules(80008297, moment("2018-02-06", "YYYY-MM-DD"), query);
    expect(parkSchedules.length).toBe(84);
    expect(parkSchedules[0].parkName).toBe("Disneyland");
    expect(parkSchedules[0].blockLevel).toBe(-1);
    expect(parkSchedules[0].crowdLevel).toBe(0);
    expect(parkSchedules[0].openTime).toBe("09:00:00");
    expect(parkSchedules[0].closeTime).toBe("20:00:00");
    expect(parkSchedules[0].magicStartTime).toBeFalsy();
}, 200000);

test('Add / Get Weather', async() => {
    var respText = await readFileAsync(__dirname + "/ForecastRet.json", {encoding: 'utf8'});
    weathers.getForecast.mockResolvedValueOnce(new Promise((resolve) => {
        var resp = JSON.parse(respText);
        for (var forecast of resp) {
            forecast.dateTime = moment(forecast.dateTime).tz("America/Los_Angeles");
        }
        
        resolve(resp);
    }));
    await resortManager.addForecasts('', 80008297, query);
    var forecasts = await resortManager.getHourlyWeather(80008297, moment("2019-02-07", "YYYY-MM-DD"), query);
    expect(forecasts.length).toBe(24);
    expect(forecasts[2].dateTime).toBe("2019-02-07 02:00:00");
    expect(forecasts[2].rainStatus).toBe(4);
    expect(forecasts[2].feelsLikeF).toBe(44);
}, 50000);

afterEach(async () => {
    await query(`DELETE FROM HourlyWeather`);
    await query(`DELETE FROM EventTimes`);
    await query(`DELETE FROM Events`);
    await query(`DELETE FROM ParkSchedules`);
});

afterAll(async () => {
    await query(`DROP TABLE HourlyWeather`);
    await query(`DROP TABLE EventTimes`);
    await query(`DROP TABLE Events`);
    await query(`DROP TABLE ParkSchedules`);
    await query(`DROP TABLE Parks`);
    await query(`DROP TABLE Resorts`);
    connection.end();
});