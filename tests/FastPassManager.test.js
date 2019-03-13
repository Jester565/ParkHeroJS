var config = require('./config');

var moment = require('moment-timezone');

var AWS = require('aws-sdk');
AWS.config.update({region: config.region});

const util = require('util');
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

var users = require('../core/User');
var passes = require('../dis/Pass');
var passManager = require('../core/PassManager');
var predictions = require('../core/Predictions');
var TIMEZONE = "America/Los_Angeles";

var RESORT_ID = "80008297";

jest.mock('../dis/Pass');
jest.mock('../core/Predictions');

var fastPassManager = require('../core/FastPassManager');

function genPassEntitlement(passID, disID, hasMaxPass=false) {
    return {
        passID: passID,
        disID: disID,
        expireDT: moment().format('YYYY-MM-DD HH:mm:ss'),
        type: 'socal-annual',
        name: 'Alex Craig',
        hasMaxPass: hasMaxPass
    }
};

async function initUsers() {
    await users.createUser('id1', 'joe', query);
    await users.createUser('id2', null, query);
    await users.createUser('id3', null, query);
}

beforeAll(async () => {
    await query(`CREATE TABLE IF NOT EXISTS Resorts (id int(11), name varchar(50), zipcode int(11), longitude decimal(9, 5), latitude decimal(9,5), timezone varchar(50), PRIMARY KEY(id))`);
    await query(`CREATE TABLE IF NOT EXISTS Parks (id int(11), name varchar(50), resortID int(11), urlName varchar(100), iconUrl varchar(255), PRIMARY KEY(id), FOREIGN KEY(resortID) REFERENCES Resorts(id))`);
    await query(`CREATE TABLE IF NOT EXISTS ParkSchedules (date DATE, parkID int(11), openTime TIME, closeTime TIME, magicHourStartTime TIME, magicHourEndTime TIME, crowdLevel int(1), blockLevel int(1), PRIMARY KEY(date, parkID), FOREIGN KEY(parkID) REFERENCES Parks(id))`); 
    await query(`CREATE TABLE IF NOT EXISTS Rides (id int(11), parkID int(11), name varchar(100), imgUrl varchar(255), height varchar(50), labels varchar(255), land varchar(100), valid tinyint(1), PRIMARY KEY (id), FOREIGN KEY (parkID) REFERENCES Parks(id))`);
    
    await query(`CREATE TABLE IF NOT EXISTS Users (id varchar(50), name varchar(50) UNIQUE, defaultName tinyint(1), PRIMARY KEY(id))`);
    await query(`CREATE TABLE IF NOT EXISTS ProfilePictures (userId varchar(50), url varchar(100), PRIMARY KEY(userId))`)
    await query(`CREATE TABLE IF NOT EXISTS Invitations (inviterId varchar(50), receiverId varchar(50), type tinyint(1), PRIMARY KEY(inviterId, receiverId), FOREIGN KEY (inviterId) REFERENCES Users(id), FOREIGN KEY (receiverId) REFERENCES Users(id))`);
    await query(`CREATE TABLE IF NOT EXISTS Friends (userId varchar(50), friendId varchar(50), PRIMARY KEY(userId, friendId), FOREIGN KEY(userId) REFERENCES Users(id), FOREIGN KEY(friendId) REFERENCES Users(id))`);
    await query(`CREATE TABLE IF NOT EXISTS Parties (id varchar(50), userID varchar(50), PRIMARY KEY(id, userID), FOREIGN KEY(userID) REFERENCES Users(id))`);
    await query(`CREATE TABLE IF NOT EXISTS DefaultNames (name varchar(50), count INT)`);
    await query(`CREATE TABLE IF NOT EXISTS ParkPasses (id varchar(200), ownerID varchar(50), name varchar(200), disID varchar(200), type varchar(200), expirationDT DATETIME, isPrimary tinyint(1), isEnabled tinyint(1), maxPassDate DATE, PRIMARY KEY(id, ownerID), FOREIGN KEY(ownerID) REFERENCES Users(id))`);
    await query(`CREATE TABLE IF NOT EXISTS PlannedFpTransactions (id varchar(100), rideID int(11), date DATE, PRIMARY KEY(id), FOREIGN KEY (rideID) REFERENCES Rides(id))`);
    await query(`CREATE TABLE IF NOT EXISTS FpTransactionPasses (transactionID varchar(100), userID varchar(50), passID varchar(200), priority int(11), PRIMARY KEY (transactionID, passID), FOREIGN KEY (transactionID) REFERENCES PlannedFpTransactions(id) ON DELETE CASCADE, FOREIGN KEY (userID) REFERENCES Users(id), FOREIGN KEY (passID) REFERENCES ParkPasses(id))`);
    await query(`CREATE TABLE IF NOT EXISTS PassSelectionTimes (passID varchar(200), selectionTime DATETIME, earliestSelectionTime DATETIME, PRIMARY KEY(passID))`);

    await query(`DELETE FROM PassSelectionTimes`);
    await query(`DELETE FROM FpTransactionPasses`);
    await query(`DELETE FROM PlannedFpTransactions`);
    await query(`DELETE FROM ParkPasses`);
    await query(`DELETE FROM DefaultNames`);
    await query(`DELETE FROM Parties`);
    await query(`DELETE FROM Friends`);
    await query(`DELETE FROM Invitations`);
    await query(`DELETE FROM ProfilePictures`);
    await query(`DELETE FROM Users`);

    await query(`DELETE FROM Rides`);
    await query(`DELETE FROM ParkSchedules`);
    await query(`DELETE FROM Parks`);
    await query(`DELETE FROM Resorts`);
    await query(`DELETE FROM ParkPasses`);

    await query(`INSERT INTO DefaultNames VALUES ?`, [[['test', 0]]]);

    await query(`INSERT INTO Resorts VALUES ?`,
            [[[80008297, 'Disneyland', 92802, 33.81011, -117.91897, 'America/Los_Angeles']]]);
    await query(`INSERT INTO Parks VALUES ?`,
        [[[330339, 'Disneyland', 80008297, 'disneyland', 'picUrl'],
        [336894, 'California Adventures', 80008297, 'disney-california-adventure', 'picUrl']]]);

    var parkDate = moment().tz(TIMEZONE).subtract(4, 'hours');
    await query(`INSERT INTO ParkSchedules VALUES ?`,
    [[
        [parkDate.format("YYYY-MM-DD"), 330339, "08:00:00", "00:00:00", null, null, 4, 4],
        [parkDate.format("YYYY-MM-DD"), 336894, "09:00:00", "22:00:00", null, null, 4, 4]
    ]]);

    await query(`INSERT INTO Rides VALUES ?`,
    [[
        [100, 330339, "Ride0", null, null, null, null, true],
        [101, 330339, "Ride1", null, null, null, null, true],
        [102, 330339, "Ride2", null, null, null, null, true],
        [103, 330339, "Ride3", null, null, null, null, true],
        [104, 336894, "Ride4", null, null, null, null, true]
    ]]);
});

/*
function genUserPassResp(userID, name, passes) {
    var passesResp = [];
    for (var pass of passes) {
        passesResp.push({
            id: pass.id,
            name: 'joe',
            type: 'socal-annual',
            expirationDT: moment().tz(TIMEZONE),
            isPrimary: pass.isPrimary,
            isEnabled: true,
            hasMaxPass: pass.hasMaxPass
        });
    }
    return ({
        user: {
            id: 'id1',
            name: 'Alex Craig',
            profilePicUrl: null
        },
        passes: passesResp
    });
}
*/

beforeEach(async () => {
    await initUsers();
});

test('empty fast passes', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    await passManager.updatePass('id1', '0', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('1', 'disID1'));
    }));
    await passManager.updatePass('id2', '1', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('2', 'disID2'));
    }));
    await passManager.updatePass('id2', '2', null, true, 'accessToken', TIMEZONE, query);
    
    
    passes.aggregateFastPassesForPassIDs.mockResolvedValueOnce(new Promise((resolve) => {
        resolve({
            selectionDateTime: moment().tz(TIMEZONE),
            earliestSelectionDateTime: moment().tz(TIMEZONE),
            transactions: [],
            individualResps: [
                {
                    passID: '0',
                    disID: 'disID0',
                    entitlements: [],
                    selectionDateTime: moment().tz(TIMEZONE),
                    earliestSelectionDateTime: moment().tz(TIMEZONE)
                },
                {
                    passID: '1',
                    disID: 'disID1',
                    entitlements: [],
                    selectionDateTime: moment().tz(TIMEZONE),
                    earliestSelectionDateTime: moment().tz(TIMEZONE)
                },
                {
                    passID: '2',
                    disID: 'disID2',
                    entitlements: [],
                    selectionDateTime: moment().tz(TIMEZONE),
                    earliestSelectionDateTime: moment().tz(TIMEZONE)
                }
            ]
        });
    }));
    
    var fps = await fastPassManager.getFastPasses([
        'id1', 'id2'
    ], 'accessToken', moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);
    expect(fps.selectionDateTime).toBeTruthy();
    expect(fps.earliestSelectionDateTime).toBeTruthy();
    expect(fps.transactions.length).toBe(0);
    expect(fps.plannedTransactions.length).toBe(0);
    expect(fps.allUserPasses.length).toBe(2);
});

test('get one fastpass', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    await passManager.updatePass('id1', '0', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('1', 'disID1'));
    }));
    await passManager.updatePass('id2', '1', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('2', 'disID2'));
    }));
    await passManager.updatePass('id2', '2', null, true, 'accessToken', TIMEZONE, query);


    var transaction0 = {
        rideID: 100,
        startDateTime: moment('2019-01-30 09:30:00', 'YYYY-MM-DD HH:mm:ss').tz(TIMEZONE),
        endDateTime: moment('2019-01-30 10:30:00', 'YYYY-MM-DD HH:mm:ss').tz(TIMEZONE),
        fps: [{ 
            passID: '0', 
            startDateTime: moment('2019-01-30 09:30:00', 'YYYY-MM-DD HH:mm:ss').tz(TIMEZONE),
            endDateTime: moment('2019-01-30 10:30:00', 'YYYY-MM-DD HH:mm:ss').tz(TIMEZONE)
        }]
    };
    passes.aggregateFastPassesForPassIDs.mockResolvedValueOnce(new Promise((resolve) => {
        resolve({
            selectionDateTime: moment().tz(TIMEZONE),
            earliestSelectionDateTime: moment().tz(TIMEZONE),
            transactions: [
                transaction0
            ],
            individualResps: [
                {
                    passID: '0',
                    disID: 'disID0',
                    entitlements: [],  //unused
                    selectionDateTime: moment().tz(TIMEZONE),
                    earliestSelectionDateTime: moment().tz(TIMEZONE)
                },
                {
                    passID: '1',
                    disID: 'disID1',
                    entitlements: [],
                    selectionDateTime: moment().tz(TIMEZONE),
                    earliestSelectionDateTime: moment().tz(TIMEZONE)
                },
                {
                    passID: '2',
                    disID: 'disID2',
                    entitlements: [],
                    selectionDateTime: moment().tz(TIMEZONE),
                    earliestSelectionDateTime: moment().tz(TIMEZONE)
                }
            ]
        });
    }));
    var fps = await fastPassManager.getFastPasses([
        'id1', 'id2'
    ], 'accessToken', moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);
    
    expect(fps.selectionDateTime).toBeTruthy();
    expect(fps.earliestSelectionDateTime).toBeTruthy();
    expect(fps.transactions.length).toBe(1);
    expect(fps.plannedTransactions.length).toBe(0);
    expect(fps.allUserPasses.length).toBe(2);
});

test('one planned fast pass', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    await passManager.updatePass('id1', '0', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('1', 'disID1'));
    }));
    await passManager.updatePass('id2', '1', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('2', 'disID2'));
    }));
    await passManager.updatePass('id2', '2', null, true, 'accessToken', TIMEZONE, query);

    var earliestSelectionDateTime = moment().tz(TIMEZONE);
    var selectionDateTime = moment().tz(TIMEZONE).add(25, 'minutes');

    passes.aggregateFastPassesForPassIDs.mockResolvedValueOnce(new Promise((resolve) => {
        resolve({
            selectionDateTime: moment().tz(TIMEZONE),
            earliestSelectionDateTime: moment().tz(TIMEZONE),
            transactions: [],
            individualResps: [
                {
                    passID: '0',
                    disID: 'disID0',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '1',
                    disID: 'disID1',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '2',
                    disID: 'disID2',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                }
            ]
        });
    }));
    await fastPassManager.updatePlannedTransactions([
        {
            rideID: 100,
            passes: [
                {
                    id: "0",
                    priority: 0
                }
            ]
        }
    ], ["id1", "id2"], moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);

    var fpDateTime = earliestSelectionDateTime.clone();
    fpDateTime.add(40, 'minutes');

    predictions.getFastPassPrediction.mockImplementationOnce((rideID, dateTime, query) => {
        expect(rideID).toBe(100);
        expect(Math.abs(moment.duration(earliestSelectionDateTime.diff(dateTime)).asMinutes()) <= 2).toBeTruthy();
        return new Promise((resolve) => {
            resolve(fpDateTime);
        });
    });

    var fps = await fastPassManager.getFastPasses([
        'id1', 'id2'
    ], 'accessToken', moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);
    
    expect(fps.selectionDateTime).toBeTruthy();
    expect(fps.earliestSelectionDateTime).toBeTruthy();
    expect(fps.transactions.length).toBe(0);
    expect(fps.allUserPasses.length).toBe(2);
    expect(fps.plannedTransactions.length).toBe(1);
    var trans = fps.plannedTransactions[0];
    expect(trans.rideID).toBe(100);
    expect(trans.fastPassTime.format('YYYY-MM-DD HH:mm:ss')).toBe(fpDateTime.format('YYYY-MM-DD HH:mm:ss'));
    expect(Math.abs(moment.duration(trans.selectionDateTime.diff(earliestSelectionDateTime)).asMinutes()) <= 2).toBeTruthy();
    expect(trans.passes.length).toBe(1);
    expect(trans.passes[0].id).toBe('0');
    expect(trans.passes[0].priority).toBe(0);


    //Test poll: Should return an update for pass 0 because earliestSelectionTime=currentTime
    var now = moment().tz(TIMEZONE);
    var parkDate = moment().tz(TIMEZONE).subtract(4, 'hours');
    passes.getEarliestPossibleSelectionDateTime.mockImplementationOnce(() => {
        return selectionDateTime.clone();
    });
    passes.orderPartyMaxPass.mockImplementationOnce((parkID, rideID, pDate, parkCloseDateTime, passIDs, disID, accessToken, tz) => {
        expect(parkID).toBe(330339);
        expect(rideID).toBe(100);
        expect(parkDate.format("YYYY-MM-DD")).toBe(pDate.format("YYYY-MM-DD"));
        expect(parkCloseDateTime.format("YYYY-MM-DD HH:mm:ss")).toBe(`${pDate.add(1, 'days').format("YYYY-MM-DD")} 00:00:00`);
        expect(passIDs[0]).toBe('0');
        expect(disID).toBe('disID0');
        expect(accessToken).toBe('accessToken');
        expect(tz).toBe(TIMEZONE);
        return new Promise((resolve, reject) => {
            resolve({
                "fastPassDateTime": moment().tz(TIMEZONE).add(1, 'hours'),
                "passes": [
                    {
                        "passID": "0",
                        "selectionDateTime": moment().tz(TIMEZONE).add(1, 'hours')
                    }
                ]
            });    
        });
    });
    var updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now, parkDate.clone(), TIMEZONE, query);
    console.log("UPDATES: ", JSON.stringify(updates));
    var keys = Object.keys(updates);
    expect(keys.length).toBe(1);
    var update = updates[keys[0]];
    expect(update[0].passID).toBe("0");
    expect(update[0].rideID).toBe(100);

    var nextUpdates = await await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now, parkDate.clone(), TIMEZONE, query);
    expect(Object.keys(nextUpdates).length).toBe(0);

    passes.aggregateFastPassesForPassIDs.mockResolvedValueOnce(new Promise((resolve) => {
        resolve({
            selectionDateTime: moment().tz(TIMEZONE),
            earliestSelectionDateTime: moment().tz(TIMEZONE),
            transactions: [],
            individualResps: [
                {
                    passID: '0',
                    disID: 'disID0',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '1',
                    disID: 'disID1',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '2',
                    disID: 'disID2',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                }
            ]
        });
    }));

    var fps = await fastPassManager.getFastPasses([
        'id1', 'id2'
    ], 'accessToken', moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);

    expect(fps.plannedTransactions.length).toBe(0);
});


test('null fast pass prediction', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    await passManager.updatePass('id1', '0', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('1', 'disID1'));
    }));
    await passManager.updatePass('id2', '1', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('2', 'disID2'));
    }));
    await passManager.updatePass('id2', '2', null, true, 'accessToken', TIMEZONE, query);

    var earliestSelectionDateTime = moment().tz(TIMEZONE).add(5, 'minutes');
    var selectionDateTime = moment().tz(TIMEZONE).add(30, 'minutes');

    passes.aggregateFastPassesForPassIDs.mockResolvedValueOnce(new Promise((resolve) => {
        resolve({
            selectionDateTime: moment().tz(TIMEZONE),
            earliestSelectionDateTime: moment().tz(TIMEZONE),
            transactions: [],
            individualResps: [
                {
                    passID: '0',
                    disID: 'disID0',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '1',
                    disID: 'disID1',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '2',
                    disID: 'disID2',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                }
            ]
        });
    }));
    await fastPassManager.updatePlannedTransactions([
        {
            rideID: 100,
            passes: [
                {
                    id: "0",
                    priority: 0
                }
            ]
        }
    ], ["id1", "id2"], moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);

    var fpDateTime = null;

    predictions.getFastPassPrediction.mockImplementationOnce((rideID, dateTime, query) => {
        expect(rideID).toBe(100);
        expect(Math.abs(moment.duration(earliestSelectionDateTime.diff(dateTime)).asMinutes()) <= 2).toBeTruthy();
        return new Promise((resolve) => {
            resolve(fpDateTime);
        });
    });

    var fps = await fastPassManager.getFastPasses([
        'id1', 'id2'
    ], 'accessToken',moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);

    var nextSelectionDateTime = earliestSelectionDateTime.clone().add(2, 'hours');
    
    expect(fps.selectionDateTime).toBeTruthy();
    expect(fps.earliestSelectionDateTime).toBeTruthy();
    expect(fps.transactions.length).toBe(0);
    expect(fps.allUserPasses.length).toBe(2);
    expect(fps.plannedTransactions.length).toBe(1);
    var trans = fps.plannedTransactions[0];
    expect(trans.rideID).toBe(100);
    expect(trans.fastPassTime).toBe(null);
    expect(trans.passes.length).toBe(1);
    expect(trans.passes[0].id).toBe('0');
    expect(trans.passes[0].priority).toBe(0);
    expect(Math.abs(moment.duration(trans.passes[0].nextSelectionDateTime.diff(nextSelectionDateTime)).asMinutes()) <= 2).toBeTruthy();

    //Get current updates: Since FastPass is 5 minutes from now, there should be no updates
    var now = moment().tz(TIMEZONE);
    var parkDate = moment().tz(TIMEZONE).subtract(4, 'hours');

    var updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now, parkDate.clone(), TIMEZONE, query);
    expect(Object.keys(updates).length).toBe(0);

    //Get updates five mins from now: Now the update should be returned
    var fiveMinsLater = now.clone().add(5, 'minutes');
    passes.getEarliestPossibleSelectionDateTime.mockImplementationOnce((selectionDateTime) => {
        return selectionDateTime.clone();
    });
    passes.orderPartyMaxPass.mockImplementationOnce(() => {
        return new Promise((resolve, reject) => {
            resolve({
                "fastPassDateTime": moment().tz(TIMEZONE).add(2, 'hours'),
                "passes": [
                    {
                        "passID": "0",
                        "selectionDateTime": moment().tz(TIMEZONE).add(2, 'hours')
                    }
                ]
            });    
        });
    });
    var nextUpdates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', fiveMinsLater, parkDate.clone(), TIMEZONE, query);
    var keys = Object.keys(nextUpdates);
    expect(keys.length).toBe(1);
    var update = nextUpdates[keys[0]];
    expect(update[0].passID).toBe("0");
    expect(update[0].rideID).toBe(100);
});

test('one planned fast passes w/ multiple passes', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    await passManager.updatePass('id1', '0', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('1', 'disID1', true));
    }));
    await passManager.updatePass('id2', '1', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('2', 'disID2'));
    }));
    await passManager.updatePass('id2', '2', null, true, 'accessToken', TIMEZONE, query);

    var earliestSelectionDateTime = moment().tz(TIMEZONE);
    var selectionDateTime = moment().tz(TIMEZONE).add(25, 'minutes');

    passes.aggregateFastPassesForPassIDs.mockResolvedValueOnce(new Promise((resolve) => {
        resolve({
            selectionDateTime: moment().tz(TIMEZONE),
            earliestSelectionDateTime: moment().tz(TIMEZONE),
            transactions: [],
            individualResps: [
                {
                    passID: '0',
                    disID: 'disID0',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '1',
                    disID: 'disID1',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '2',
                    disID: 'disID2',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                }
            ]
        });
    }));
    await fastPassManager.updatePlannedTransactions([
        {
            rideID: 100,
            passes: [
                {
                    id: "0",
                    priority: 0
                },
                {
                    id: "1",
                    priority: 0
                },
                {
                    id: "2",
                    priority: 0
                }
            ]
        }
    ], ["id1", "id2"], moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);

    var fpDateTime = earliestSelectionDateTime.clone();
    fpDateTime.add(140, 'minutes');

    predictions.getFastPassPrediction.mockImplementationOnce((rideID, dateTime, query) => {
        expect(rideID).toBe(100);
        expect(Math.abs(moment.duration(earliestSelectionDateTime.diff(dateTime)).asMinutes()) <= 2).toBeTruthy();
        return new Promise((resolve) => {
            resolve(fpDateTime);
        });
    });

    var fps = await fastPassManager.getFastPasses([
        'id1', 'id2'
    ], 'accessToken', moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);

    var nextSelectionDateTimeMaxPass = earliestSelectionDateTime.clone().add(90, 'minutes');
    var nextSelectionDateTimeNonMaxPass = earliestSelectionDateTime.clone().add(2, 'hours');
    
    expect(fps.selectionDateTime).toBeTruthy();
    expect(fps.earliestSelectionDateTime).toBeTruthy();
    expect(fps.transactions.length).toBe(0);
    expect(fps.allUserPasses.length).toBe(2);
    expect(fps.plannedTransactions.length).toBe(1);
    var trans = fps.plannedTransactions[0];
    expect(trans.rideID).toBe(100);
    expect(trans.fastPassTime.format("YYYY-MM-DD HH:mm:ss")).toBe(fpDateTime.format("YYYY-MM-DD HH:mm:ss"));
    expect(trans.passes.length).toBe(3);
    trans.passes.sort((pass1, pass2) => {
        return pass1.id.localeCompare(pass2.id);
    });
    expect(trans.passes[0].id).toBe('0');
    expect(trans.passes[0].priority).toBe(0);
    expect(Math.abs(moment.duration(trans.passes[0].nextSelectionDateTime.diff(nextSelectionDateTimeNonMaxPass)).asMinutes()) <= 2).toBeTruthy();
    expect(trans.passes[1].id).toBe('1');
    expect(trans.passes[1].priority).toBe(0);
    expect(Math.abs(moment.duration(trans.passes[1].nextSelectionDateTime.diff(nextSelectionDateTimeMaxPass)).asMinutes()) <= 2).toBeTruthy();
    expect(trans.passes[2].id).toBe('2');
    expect(trans.passes[2].priority).toBe(0);
    expect(Math.abs(moment.duration(trans.passes[2].nextSelectionDateTime.diff(nextSelectionDateTimeNonMaxPass)).asMinutes()) <= 2).toBeTruthy();
    
    //Poll FastPasses for group: Should return 2 users being updated.
    var now = moment().tz(TIMEZONE);
    var parkDate = moment().tz(TIMEZONE).subtract(4, 'hours');
    passes.getEarliestPossibleSelectionDateTime.mockImplementation((selectionDateTime) => {
        return selectionDateTime.clone();
    });
    passes.orderPartyMaxPass.mockImplementationOnce((parkID, rideID, date, parkCloseDateTime, passIDs, disID) => {
        expect(parkID).toBe(330339);
        expect(rideID).toBe(100);
        var sortedPassIDs = passIDs.slice().sort((a, b) => {
            return a.localeCompare(b);
        });
        expect(sortedPassIDs.length).toBe(3);
        expect(sortedPassIDs[0]).toBe('0');
        expect(sortedPassIDs[1]).toBe('1');
        expect(sortedPassIDs[2]).toBe('2');
        expect(disID == 'disID0' || disID == 'disID1' || disID == 'disID2').toBeTruthy();
        return new Promise((resolve) => {
            resolve({
                "fastPassDateTime": moment().tz(TIMEZONE).add(2, 'hours'),
                "passes": [
                    {
                        "passID": "0",
                        "selectionDateTime": moment().tz(TIMEZONE).add(2, 'hours')
                    },
                    {
                        "passID": "1",
                        "selectionDateTime": moment().tz(TIMEZONE).add(2, 'hours')
                    },
                    {
                        "passID": "2",
                        "selectionDateTime": moment().tz(TIMEZONE).add(2, 'hours')
                    }
                ]
            });    
        });
    });

    var updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now, parkDate.clone(), TIMEZONE, query);
    var keys = Object.keys(updates);
    expect(keys.length).toBe(2);
    var update1 = updates["id1"];
    expect(update1.length).toBe(1);
    expect(update1[0].passID).toBe("0");
    expect(update1[0].rideID).toBe(100);
    var update2 = updates["id2"];
    expect(update2.length).toBe(2);
    var sortedUpdate2Passes = update2.slice().sort((a, b) => {
        return a.passID.localeCompare(b.passID);
    });
    expect(sortedUpdate2Passes[0].passID == "1");
    expect(sortedUpdate2Passes[1].passID == "2");
});

test('multiple fast passes & multiple passes', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    await passManager.updatePass('id1', '0', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('1', 'disID1', true));
    }));
    await passManager.updatePass('id2', '1', true, true, 'accessToken', TIMEZONE, query);
    
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('2', 'disID2'));
    }));
    await passManager.updatePass('id2', '2', null, true, 'accessToken', TIMEZONE, query);

    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('3', 'disID3', true));
    }));
    await passManager.updatePass('id3', '3', null, true, 'accessToken', TIMEZONE, query);

    var earliestSelectionDateTime = moment().tz(TIMEZONE);
    var selectionDateTime = earliestSelectionDateTime.clone();

    var id3EarliestSelectionDateTime = moment().tz(TIMEZONE).add(84, 'minutes');
    var id3SelectionDateTime = earliestSelectionDateTime.clone();

    var transaction0 = {
        rideID: 100,
        startDateTime: moment('2019-01-30 09:30:00', 'YYYY-MM-DD HH:mm:ss').tz(TIMEZONE),
        endDateTime: moment('2019-01-30 10:30:00', 'YYYY-MM-DD HH:mm:ss').tz(TIMEZONE),
        fps: [{ 
            passID: '0', 
            startDateTime: moment('2019-01-30 09:30:00', 'YYYY-MM-DD HH:mm:ss').tz(TIMEZONE),
            endDateTime: moment('2019-01-30 10:30:00', 'YYYY-MM-DD HH:mm:ss').tz(TIMEZONE)
        }]
    };

    passes.aggregateFastPassesForPassIDs.mockResolvedValue(new Promise((resolve) => {
        resolve({
            selectionDateTime: selectionDateTime,
            earliestSelectionDateTime: earliestSelectionDateTime,
            transactions: [
                transaction0
            ],
            individualResps: [
                {
                    passID: '0',
                    disID: 'disID0',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '1',
                    disID: 'disID1',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '2',
                    disID: 'disID2',
                    entitlements: [],
                    selectionDateTime: selectionDateTime,
                    earliestSelectionDateTime: earliestSelectionDateTime
                },
                {
                    passID: '3',
                    disID: 'disID3',
                    entitlements: [],  //unused
                    selectionDateTime: id3SelectionDateTime,
                    earliestSelectionDateTime: id3EarliestSelectionDateTime
                }
            ]
        });
    }));
    await fastPassManager.updatePlannedTransactions([
        {
            id: "t0",
            rideID: 100,
            passes: [
                {
                    id: "0",
                    priority: 0
                },
                {
                    id: "1",
                    priority: 0
                },
                {
                    id: "2",
                    priority: 0
                }
            ]
        },
        {
            id: "t1",
            rideID: 101,
            passes: [
                {
                    id: "1",
                    priority: 1
                },
                {
                    id: "2",
                    priority: 1
                }
            ]
        },
        {
            id: "t2",
            rideID: 102,
            passes: [
                {
                    id: "0",
                    priority: 1
                }
            ]
        },
        {
            id: "t3",
            rideID: 102,
            passes: [
                {
                    id: "0",
                    priority: 2
                },
                {
                    id: "1",
                    priority: 2
                }
            ]
        },
        {
            id: "t4",
            rideID: 103,
            passes: [
                {
                    id: "0",
                    priority: 3
                },
                {
                    id: "1",
                    priority: 3
                },
                {
                    id: "2",
                    priority: 2
                },
                {
                    id: "3",
                    priority: 1
                }
            ]
        },
        {
            id: "t5",
            rideID: 104,
            passes: [
                {
                    id: "3",
                    priority: 0
                }
            ]
        }
    ], ["id1", "id2", "id3"], moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);

    var r100FpTime = earliestSelectionDateTime.clone().add(129, 'minutes');
    var r101FpTime = earliestSelectionDateTime.clone().add(125, 'minutes');
    var r102FpTime1 = earliestSelectionDateTime.clone().add(219, 'minutes');
    var r102FpTime2 = null;
    var r103FpTime = earliestSelectionDateTime.clone().add(350, 'minutes');
    var r104FpTime = null;

    var first102Prediction = true;
    predictions.getFastPassPrediction.mockImplementation((rideID, dateTime, query) => {
        if (rideID == 100) {
            expect(Math.abs(Math.round(moment.duration(earliestSelectionDateTime.diff(dateTime)).asMinutes())) == 0).toBeTruthy();
            return new Promise((resolve) => {
                resolve(r100FpTime);
            });
        } else if (rideID == 101) {
            expect(Math.abs(Math.round(moment.duration(earliestSelectionDateTime.diff(dateTime)).asMinutes())) == 120).toBeTruthy();
            return new Promise((resolve) => {
                resolve(r101FpTime);
            });
        } else if (rideID == 102) {
            if (first102Prediction) {
                first102Prediction = false;
                expect(Math.abs(Math.round(moment.duration(earliestSelectionDateTime.diff(dateTime)).asMinutes())) == 120).toBeTruthy();
                return new Promise((resolve) => {
                    resolve(r102FpTime1);
                });
            } else {
                console.log("DIFF: ", Math.round(moment.duration(earliestSelectionDateTime.diff(dateTime)).asMinutes()));
                expect(Math.abs(Math.round(moment.duration(earliestSelectionDateTime.diff(dateTime)).asMinutes())) == 219).toBeTruthy();
                return new Promise((resolve) => {
                    resolve(r102FpTime2);
                });
            }
        } else if (rideID == 103) {
            expect(Math.abs(Math.round(moment.duration(earliestSelectionDateTime.diff(dateTime)).asMinutes())) == 339).toBeTruthy();
            return new Promise((resolve) => {
                resolve(r103FpTime);
            });
        } else if (rideID == 104) {
            return new Promise((resolve) => {
                resolve(null);
            });
        }
    });

    var fps = await fastPassManager.getFastPasses([
        'id1', 'id2', 'id3'
    ], 'accessToken', moment().tz(TIMEZONE).subtract(4, 'hours'), TIMEZONE, query);

    expect(fps.selectionDateTime).toBeTruthy();
    expect(fps.earliestSelectionDateTime).toBeTruthy();
    expect(fps.transactions.length).toBe(1);
    expect(fps.allUserPasses.length).toBe(3);
    expect(fps.plannedTransactions.length).toBe(6);
    var trans = fps.plannedTransactions;
    trans.sort((t1, t2) => {
        return t1.id.localeCompare(t2.id);
    });
    var checkTransaction = (trans, rideID, selectionMins, fastPassTime, passIDs) => {
        expect(trans.rideID).toBe(rideID);
        var selectionTime = earliestSelectionDateTime.clone().add(selectionMins, 'minutes');
        //trans.selectionDateTime
        expect(Math.abs(Math.round(moment.duration(trans.selectionDateTime.diff(selectionTime)).asMinutes())) == 0).toBeTruthy();
        if (fastPassTime != null) {
            expect(Math.abs(Math.round(moment.duration(trans.fastPassTime.diff(fastPassTime)).asMinutes())) == 0).toBeTruthy();
        } else {
            expect(fastPassTime).toBe(null);
        }
        trans.passes.sort((pass1, pass2) => {
            return pass1.id.localeCompare(pass2.id);
        });
        trans.passes.forEach((pass, i) => {
            expect(pass.id).toBe(passIDs[i]);
        });
    }
    checkTransaction(trans[0], 100, 0, r100FpTime, ['0', '1', '2']);
    checkTransaction(trans[1], 101, 120, r101FpTime, ['1', '2']);
    checkTransaction(trans[2], 102, 120, r102FpTime1, ['0']);
    checkTransaction(trans[3], 102, 219, r102FpTime2, ['0', '1']);
    checkTransaction(trans[4], 103, 339, r103FpTime, ['0', '1', '2', '3']);
    checkTransaction(trans[5], 104, 84, r104FpTime, ['3']);

    predictions.getFastPassPrediction.mockImplementation((rideID, dateTime, query) => {
        return new Promise((resolve) => {
            resolve(r100FpTime);
        });
    });
    
    //Test poll: Should return an update for pass 0 because earliestSelectionTime=currentTime
    var now = moment().tz(TIMEZONE);
    var parkDate = moment().tz(TIMEZONE).subtract(4, 'hours');
    passes.getEarliestPossibleSelectionDateTime.mockImplementation((sdt) => {
        return sdt.clone();
    });
    var orderPassResults = {
        "100": {
            "parkID": 330339,
            "parkDate": parkDate.format("YYYY-MM-DD"),
            "parkCloseDateTime": `${parkDate.clone().add(1, 'days').format("YYYY-MM-DD")} 00:00:00`,
            "passIDs": ['0', '1', '2'],
            "disIDs": ['disID0', 'disID1', 'disID2'],
            //result
            "fastPassDateTime": r100FpTime.clone(),
            "selectionDateTime": moment().tz(TIMEZONE).add(120, 'minutes')
        }
    };
    passes.orderPartyMaxPass.mockImplementation((parkID, rideID, pDate, parkCloseDateTime, passIDs, disID, accessToken, tz) => {
        var passResult = orderPassResults[rideID];
        expect(passResult).toBeTruthy();

        expect(parkID).toBe(passResult.parkID);
        expect(parkDate.format("YYYY-MM-DD")).toBe(passResult.parkDate);
        expect(parkCloseDateTime.format("YYYY-MM-DD HH:mm:ss")).toBe(passResult.parkCloseDateTime);
        
        expect(passIDs.length).toBe(passResult.passIDs.length);
        expect(passIDs).toEqual(
            expect.arrayContaining(passResult.passIDs)
        );
        expect(passResult.disIDs.indexOf(disID) >= 0).toBeTruthy();
        
        expect(accessToken).toBe('accessToken');
        expect(tz).toBe(TIMEZONE);
        return new Promise((resolve, reject) => {
            //Indicates the transaction failed but not due to fastPass availability
            if (passResult.error != null) {
                throw passResult.error;
            }
            //Null means fastPasses are no longer available
            if (passResult.fastPassDateTime == null) {
                resolve(null);
            }
            var passes = [];
            for (var passID of passIDs) {
                passes.push({
                    "passID": passID,
                    "selectionDateTime": passResult.selectionDateTime
                });
            }
            resolve({
                "fastPassDateTime": passResult.fastPassDateTime,
                "passes": passes
            });    
        });
    });
    var updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now.clone(), parkDate.clone(), TIMEZONE, query);
    console.log("UPDATES 1: ", JSON.stringify(updates));

    orderPassResults = {
        "104": {
            "parkID": 336894,
            "parkDate": parkDate.format("YYYY-MM-DD"),
            "parkCloseDateTime": `${parkDate.format("YYYY-MM-DD")} 22:00:00`,
            "passIDs": ['3'],
            "disIDs": ['disID3'],
            //result
            "fastPassDateTime": null,
            "selectionDateTime": null
        },
        "101": {
            "parkID": 330339,
            "parkDate": parkDate.format("YYYY-MM-DD"),
            "parkCloseDateTime": `${parkDate.clone().add(1, 'days').format("YYYY-MM-DD")} 00:00:00`,
            "passIDs": ['1', '2'],
            "disIDs": ['disID1', 'disID2'],
            //result
            "fastPassDateTime": r101FpTime.clone(),
            "selectionDateTime": r101FpTime.clone()
        },
        "102": {
            "parkID": 330339,
            "parkDate": parkDate.format("YYYY-MM-DD"),
            "parkCloseDateTime": `${parkDate.clone().add(1, 'days').format("YYYY-MM-DD")} 00:00:00`,
            "passIDs": ['0'],
            "disIDs": ['disID0'],
            //result
            "error": "Conflict"
        }
    };
    updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now.clone().add(122, 'minutes'), parkDate.clone(), TIMEZONE, query);
    console.log("UPDATES 2: ", JSON.stringify(updates));
    
    orderPassResults = {
        "102": {
            "parkID": 330339,
            "parkDate": parkDate.format("YYYY-MM-DD"),
            "parkCloseDateTime": `${parkDate.clone().add(1, 'days').format("YYYY-MM-DD")} 00:00:00`,
            "passIDs": ['0'],
            "disIDs": ['disID0'],
            //result
            "fastPassDateTime": r102FpTime1.clone(),
            "selectionDateTime": moment().tz(TIMEZONE).add(243, 'minutes')
        }
    };
    updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now.clone().add(123, 'minutes'), parkDate.clone(), TIMEZONE, query);
    console.log("UPDATES 3: ", JSON.stringify(updates));

    //After 84 minutes
    orderPassResults = {};
    updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now.clone().add(123, 'minutes'), parkDate.clone(), TIMEZONE, query);
    console.log("UPDATES 4: ", JSON.stringify(updates));

    orderPassResults = {
        "102": {
            "parkID": 330339,
            "parkDate": parkDate.format("YYYY-MM-DD"),
            "parkCloseDateTime": `${parkDate.clone().add(1, 'days').format("YYYY-MM-DD")} 00:00:00`,
            "passIDs": ['0', '1'],
            "disIDs": ['disID0'],
            //result
            "fastPassDateTime": r103FpTime.clone(),
            "selectionDateTime": moment().tz(TIMEZONE).add(300, 'minutes')
        }
    };
    updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now.clone().add(245, 'minutes'), parkDate.clone(), TIMEZONE, query);
    console.log("UPDATES 5: ", JSON.stringify(updates));

    orderPassResults = {
        "102": {
            "parkID": 330339,
            "parkDate": parkDate.format("YYYY-MM-DD"),
            "parkCloseDateTime": `${parkDate.clone().add(1, 'days').format("YYYY-MM-DD")} 00:00:00`,
            "passIDs": ['0', '1'],
            "disIDs": ['disID0'],
            //result
            "fastPassDateTime": r103FpTime.clone(),
            "selectionDateTime": moment().tz(TIMEZONE).add(300, 'minutes')
        }
    };
    updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now.clone().add(245, 'minutes'), parkDate.clone(), TIMEZONE, query);

    orderPassResults = {
        "103": {
            "parkID": 330339,
            "parkDate": parkDate.format("YYYY-MM-DD"),
            "parkCloseDateTime": `${parkDate.clone().add(1, 'days').format("YYYY-MM-DD")} 00:00:00`,
            "passIDs": ['0', '1', '2', '3'],
            "disIDs": ['disID0', 'disID1', 'disID2', 'disID3'],
            //result
            "fastPassDateTime": r103FpTime.clone(),
            "selectionDateTime": moment().tz(TIMEZONE).add(400, 'minutes')
        }
    };
    updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now.clone().add(302, 'minutes'), parkDate.clone(), TIMEZONE, query);
    console.log("UPDATES 6: ", JSON.stringify(updates));

    orderPassResults = {};
    updates = await fastPassManager.pollMaxPassOrders(RESORT_ID, 'accessToken', now.clone().add(401, 'minutes'), parkDate.clone(), TIMEZONE, query);
    console.log("UPDATES 7: ", JSON.stringify(updates));
});

afterEach(async () => {
    await query(`DELETE FROM PassSelectionTimes`);
    await query(`DELETE FROM FpTransactionPasses`);
    await query(`DELETE FROM PlannedFpTransactions`);
    await query(`DELETE FROM ParkPasses`);
    await query(`DELETE FROM Users`);
});

afterAll(async () => {
    await query(`DROP TABLE PassSelectionTimes`);
    await query(`DROP TABLE FpTransactionPasses`);
    await query(`DROP TABLE PlannedFpTransactions`);
    await query(`DROP TABLE ParkPasses`);
    await query(`DROP TABLE DefaultNames`);
    await query(`DROP TABLE Parties`);
    await query(`DROP TABLE Friends`);
    await query(`DROP TABLe Invitations`);
    await query(`DROP TABLE ProfilePictures`);
    await query(`DROP TABLE Users`);
    await query(`DROP TABLE Rides`);
    await query(`DROP TABLE ParkSchedules`);
    await query(`DROP TABLE Parks`);
    await query(`DROP TABLE Resorts`);
    connection.end();
});