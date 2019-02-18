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

jest.mock('../dis/Pass');

function genPassEntitlement(passID, disID) {
    return {
        passID: passID,
        disID: disID,
        expireDT: moment().format('YYYY-MM-DD HH:mm:ss'),
        type: 'socal-annual',
        name: 'Alex Craig',

    }
};

async function initUsers() {
    await users.createUser('id1', 'joe', query);
    await users.createUser('id2', null, query);
    await users.createUser('id3', null, query);
}

beforeAll(async () => {
    console.log("BEFORE ALL INVOKED");
    await query(`CREATE TABLE IF NOT EXISTS Users (id varchar(50), name varchar(50) UNIQUE, defaultName tinyint(1), PRIMARY KEY(id))`);
    await query(`CREATE TABLE IF NOT EXISTS ProfilePictures (userId varchar(50), url varchar(100), PRIMARY KEY(userId))`)
    await query(`CREATE TABLE IF NOT EXISTS Invitations (inviterId varchar(50), receiverId varchar(50), type tinyint(1), PRIMARY KEY(inviterId, receiverId), FOREIGN KEY (inviterId) REFERENCES Users(id), FOREIGN KEY (receiverId) REFERENCES Users(id))`);
    await query(`CREATE TABLE IF NOT EXISTS Friends (userId varchar(50), friendId varchar(50), PRIMARY KEY(userId, friendId), FOREIGN KEY(userId) REFERENCES Users(id), FOREIGN KEY(friendId) REFERENCES Users(id))`);
    await query(`CREATE TABLE IF NOT EXISTS Parties (id varchar(50), userID varchar(50), PRIMARY KEY(id, userID), FOREIGN KEY(userID) REFERENCES Users(id))`);
    await query(`CREATE TABLE IF NOT EXISTS DefaultNames (name varchar(50), count INT)`);
    await query(`CREATE TABLE IF NOT EXISTS ParkPasses (id varchar(200), ownerID varchar(50), name varchar(200), disID varchar(200), type varchar(200), expirationDT DATETIME, isPrimary tinyint(1), isEnabled tinyint(1), maxPassDate DATE, PRIMARY KEY(id, ownerID), FOREIGN KEY(ownerID) REFERENCES Users(id))`);
    await query(`DELETE FROM ParkPasses`);
    await query(`DELETE FROM DefaultNames`);
    await query(`DELETE FROM Parties`);
    await query(`DELETE FROM Friends`);
    await query(`DELETE FROM Invitations`);
    await query(`DELETE FROM ProfilePictures`);
    await query(`DELETE FROM Users`);
    await query(`INSERT INTO DefaultNames VALUES ?`, [[['test', 0]]]);
    console.log("BEFORE ALL DONE");
});

beforeEach(async () => {
    await initUsers();
});

test('get empty passes', async () => {
    var userPasses = await passManager.getPassesForUsers(['id1', 'id2', 'id3'], false, "America/Los_Angeles", query);
    expect(userPasses.length).toBe(0);
});

test('add pass', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    await passManager.updatePass('id1', '0', null, true, 'acessToken', "America/Los_Angeles", query);
    var userPasses = await passManager.getPassesForUsers(['id1'], false, "America/Los_Angeles", query);
    expect(userPasses[0].passes[0].id).toEqual('0');
});

test('add same pass', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    await passManager.updatePass('id1', '0', null, true, 'accessToken', "America/Los_Angeles", query);
    await passManager.updatePass('id1', '0', null, true, 'accessToken', "America/Los_Angeles", query);
    var userPasses = await passManager.getPassesForUsers(['id1'], false, "America/Los_Angeles", query);
    expect(userPasses[0].passes.length).toBe(1);
    expect(userPasses[0].passes[0].id).toEqual('0');
});

test('add same pass to different users - secondary', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    await passManager.updatePass('id1', '0', false, true, 'accessToken', "America/Los_Angeles", query);
    await passManager.updatePass('id2', '0', true, true, 'accessToken', "America/Los_Angeles", query);
    {
        var userPasses = await passManager.getPassesForUsers(['id1'], false, "America/Los_Angeles", query);
        expect(userPasses.length).toBe(1);
        expect(userPasses[0].passes[0].id).toEqual('0');
    }
    {
        var userPasses = await passManager.getPassesForUsers(['id2'], false, "America/Los_Angeles", query);
        expect(userPasses.length).toBe(1);
        expect(userPasses[0].passes[0].id).toEqual('0');
    }
    {
        var userPasses = await passManager.getPassesForUsers(['id1', 'id2'], false, "America/Los_Angeles", query);
        expect(userPasses.length).toBe(1);
        expect(userPasses[0].user.id).toEqual('id2');
        expect(userPasses[0].passes[0].id).toEqual('0');
    }
});

test('add same pass to different users - primary', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    await passManager.updatePass('id1', '0', true, true, 'accessToken', "America/Los_Angeles", query);
    var error = null;
    try {
        await passManager.updatePass('id2', '0', true, true, 'accessToken', "America/Los_Angeles", query);
    } catch (e) {
        error = e;
    }
    expect(error).toBeTruthy();
    {
        var userPasses = await passManager.getPassesForUsers(['id1', 'id2'], false, "America/Los_Angeles", query);
        expect(userPasses.length).toBe(1);
        expect(userPasses[0].user.id).toEqual('id1');
        expect(userPasses[0].passes[0].id).toEqual('0');
    }
});

test('multiple passes to same user', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('1', 'disID1'));
    }));
    await passManager.updatePass('id1', '0', null, true, 'accessToken', "America/Los_Angeles", query);
    await passManager.updatePass('id1', '1', null, true, 'accessToken', "America/Los_Angeles", query);
    {
        var userPasses = await passManager.getPassesForUsers(['id1'], false, "America/Los_Angeles", query);
        expect(userPasses[0].passes[0].id).toEqual('0');
        expect(userPasses[0].passes[1].id).toEqual('1');
    }
});

test('enabled queries', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('1', 'disID1'));
    }));
    await passManager.updatePass('id1', '0', null, true, 'accessToken', "America/Los_Angeles", query);
    await passManager.updatePass('id1', '1', null, false, 'accessToken', "America/Los_Angeles", query);
    {
        var userPasses = await passManager.getPassesForUsers(['id1'], false, "America/Los_Angeles", query);
        expect(userPasses.length).toBe(1);
        expect(userPasses[0].passes.length).toBe(1);
        expect(userPasses[0].passes[0].id).toEqual('0');
    }
    {
        var userPasses = await passManager.getPassesForUsers(['id1'], true, "America/Los_Angeles", query);
        expect(userPasses.length).toBe(1);
        expect(userPasses[0].passes.length).toBe(2);
        expect(userPasses[0].passes[0].id).toEqual('0');
        expect(userPasses[0].passes[1].id).toEqual('1');
    }
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('1', 'disID1'));
    }));
    await passManager.updatePass('id1', '1', null, true, 'accessToken', "America/Los_Angeles", query);
    {
        var userPasses = await passManager.getPassesForUsers(['id1'], false, "America/Los_Angeles", query);
        expect(userPasses.length).toBe(1);
        expect(userPasses[0].passes.length).toBe(2);
        expect(userPasses[0].passes[0].id).toEqual('0');
        expect(userPasses[0].passes[1].id).toEqual('1');
    }
});

test('remove pass', async () => {
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('0', 'disID0'));
    }));
    passes.getParsedPass.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(genPassEntitlement('1', 'disID1'));
    }));
    await passManager.updatePass('id1', '0', true, true, 'accessToken', "America/Los_Angeles", query);
    await passManager.updatePass('id1', '1', true, true, 'accessToken', "America/Los_Angeles", query);
    await passManager.removePass('id1', '0', query);
    {
        var userPasses = await passManager.getPassesForUsers(['id1'], false, "America/Los_Angeles", query);
        expect(userPasses.length).toBe(1);
        expect(userPasses[0].user.id).toEqual('id1');
        expect(userPasses[0].passes[0].id).toEqual('1');
    }
    await passManager.removePass('id1', '1', query);
    {
        var userPasses = await passManager.getPassesForUsers(['id1'], false, "America/Los_Angeles", query);
        expect(userPasses.length).toBe(0);
    }
});

afterEach(async () => {
    await query(`DELETE FROM ParkPasses`);
    await query(`DELETE FROM Users`);
});

afterAll(async () => {
    await query(`DROP TABLE ParkPasses`);
    await query(`DROP TABLE DefaultNames`);
    await query(`DROP TABLE Parties`);
    await query(`DROP TABLE Friends`);
    await query(`DROP TABLe Invitations`);
    await query(`DROP TABLE ProfilePictures`);
    await query(`DROP TABLE Users`);
    connection.end();
});