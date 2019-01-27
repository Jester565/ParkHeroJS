var config = require('./config');

const util = require('util');

var fs = require('fs');
const readFile = util.promisify(fs.readFile).bind(fs);

var AWS = require('aws-sdk');
AWS.config.update({region: config.region});

var s3 = new AWS.S3();
var dynamodb = new AWS.DynamoDB();

const vision = require('@google-cloud/vision');

var bucket = config.s3.bucket;
var appropiateImgPath = config.s3.appropiatePic;
var inappropiateImgPath = config.s3.inappropiatePic;

var appropiateImgKey = 'tests/appropiate' + appropiateImgPath.substr(appropiateImgPath.lastIndexOf('.'));
var inappropiateImgKey = 'tests/inappropiate' + inappropiateImgPath.substr(inappropiateImgPath.lastIndexOf('.'));

const imageAnnotatorClient = new vision.ImageAnnotatorClient({
	keyFile: config.google.configFile
});

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

async function uploadFile(path, key) {
    var data = await readFile(path);
    await s3.putObject({
        Bucket: bucket,
        Key: key,
        Body: data
    }).promise();
}

async function initUsers() {
    await users.createUser('id1', 'joe', query, dynamodb);
    await users.createUser('id2', null, query, dynamodb);
    await users.createUser('id3', null, query, dynamodb);
}

beforeAll(async () => {
    await query(`CREATE TABLE IF NOT EXISTS Users (id varchar(50), name varchar(50) UNIQUE, defaultName tinyint(1), PRIMARY KEY(id))`);
    await query(`CREATE TABLE IF NOT EXISTS ProfilePictures (userId varchar(50), url varchar(100), PRIMARY KEY(userId))`)
    await query(`CREATE TABLE IF NOT EXISTS Invitations (inviterId varchar(50), receiverId varchar(50), type tinyint(1), PRIMARY KEY(inviterId, receiverId), FOREIGN KEY (inviterId) REFERENCES Users(id), FOREIGN KEY (receiverId) REFERENCES Users(id))`);
    await query(`CREATE TABLE IF NOT EXISTS Friends (userId varchar(50), friendId varchar(50), PRIMARY KEY(userId, friendId), FOREIGN KEY(userId) REFERENCES Users(id), FOREIGN KEY(friendId) REFERENCES Users(id))`);
    await query(`CREATE TABLE IF NOT EXISTS Parties (id varchar(50), userID varchar(50), PRIMARY KEY(id, userID), FOREIGN KEY(userID) REFERENCES Users(id))`);
    await query(`CREATE TABLE IF NOT EXISTS DefaultNames (name varchar(50), count INT)`);
    await query(`DELETE FROM DefaultNames`);
    await query(`DELETE FROM Parties`);
    await query(`DELETE FROM Friends`);
    await query(`DELETE FROM Invitations`);
    await query(`DELETE FROM ProfilePictures`);
    await query(`DELETE FROM Users`);
    await query(`INSERT INTO DefaultNames VALUES ?`, [[['test', 0]]]);
});

describe('Create user tests', () => {
    test('create user - custom name', async () => {
        await users.createUser('id1', 'joe', query, dynamodb);
        expect(await users.getUser('id1', query)).toEqual({ id: 'id1', name: 'joe', profilePicUrl: null });
    });

    test('create user - default name', async () => {
        await users.createUser('id2', null, query, dynamodb);
        expect(await users.getUser('id2', query)).toEqual({ id: 'id2', name: 'test0', profilePicUrl: null });
        await users.createUser('id3', null, query, dynamodb);
        expect(await users.getUser('id3', query)).toEqual({ id: 'id3', name: 'test1', profilePicUrl: null });
    });

    afterEach(async () => {
        await query(`DELETE FROM Users`);
    });
});

/*
describe('ProfilePic', () => {
    beforeAll(async () => {
        await uploadFile(appropiateImgPath, appropiateImgKey);
        await uploadFile(inappropiateImgPath, inappropiateImgKey);
    });

    beforeEach(async() => {
        await initUsers();
    });

    test('Create profile picture', async () => {
        await users.updateProfilePic('id1', bucket, appropiateImgKey, query, s3, imageAnnotatorClient);
        expect((await users.getUser('id1', query))['profilePicUrl']).toBe('profileImgs/id1');
        var objectLists = await s3.listObjects({
            Bucket: bucket,
            Prefix: 'profileImgs/id1'
        }).promise();
        
        expect(objectLists.Contents.length).toBe(4);
    });

    test('profile pic - attempt inappropiate profile picture', async () => {
        var error = null;
        try {
            await users.updateProfilePic('id2', bucket, inappropiateImgKey, query, s3, imageAnnotatorClient);
        } catch (e) {
            error = e;
        }
        expect(error).toBeTruthy();

        expect((await users.getUser('id2', query))['profilePicUrl']).toBeFalsy();

        var objectLists = await s3.listObjects({
            Bucket: bucket,
            Prefix: 'profileImgs/id2'
        }).promise();
        
        expect(objectLists.Contents.length).toBe(0);
    });

    afterEach(async() => {
        await query(`DELETE FROM ProfilePictures`);
        await query(`DELETE FROM Users`);
    });

    afterAll(async() => {
        var deleteKeysWithPrefix = async(prefix) => {
            var objectLists = await s3.listObjects({
                Bucket: bucket,
                Prefix: prefix
            }).promise();

            var deletePromises = [];
            for (var object of objectLists.Contents) {
                deletePromises.push(s3.deleteObject({
                    Bucket: bucket,
                    Key: object.Key
                }).promise());
            }
            await Promise.all(deletePromises);
        }
        await deleteKeysWithPrefix('profileImgs/id1');
        await deleteKeysWithPrefix('profileImgs/id2');
    });
});
*/

describe('Query Users Test', () => {
    beforeEach(async() => {
        await initUsers();
    });

    test('getUsers', async () => {
        var usrs = await users.getUsers(['id1', 'id2', 'id3'], query);
        expect(usrs.length).toBe(3);
    });

    test('searchUsers', async () => {
        var searchResults = await users.searchUsers('te', 'id2', query);
        expect(searchResults.length).toBe(1);
    });

    afterEach(async() => {
        await query(`DELETE FROM Users`);
    });
});

describe('Friends tests', () => {
    beforeEach(async() => {
        await initUsers();
    });
    
    test('getInvites - no invites', async() => {
        var invites = await users.getInvites('id1', users.FRIEND_INVITE_TYPE, query);
        expect(invites.length).toBe(0);
    });

    test('getFriends - no friends', async() => {
        var friends = await users.getFriends('id1', query);
        expect(friends.length).toBe(0);
    });

    test('invite friend', async() => {
        //id1 invites id2
        var isFriend = await users.addFriend('id1', 'id2', query);
        expect(isFriend).toBeFalsy();
        {
            var invites = await users.getInvites('id1', users.FRIEND_INVITE_TYPE, query);
            expect(invites.length).toBe(1);
        }
        {
            var invites = await users.getInvites('id2', users.FRIEND_INVITE_TYPE, query);
            expect(invites.length).toBe(1);
        }
    });

    test(`accept friend invite`, async() => {
        await users.addFriend('id1', 'id2', query);
        isFriend = await users.addFriend('id2', 'id1', query);
        expect(isFriend).toBeTruthy();
        {
            var invites = await users.getInvites('id1', users.FRIEND_INVITE_TYPE, query);
            expect(invites.length).toBe(0);
        }
        {
            var friends = await users.getFriends('id1', query);
            expect(friends.length).toBe(1);
        }
    });

    test(`accept own invite`, async() => {
        await users.addFriend('id1', 'id2', query);
        var isFriend = await users.addFriend('id1', 'id2', query);
        expect(isFriend).toBeFalsy();
        {
            var invites = await users.getInvites('id1', users.FRIEND_INVITE_TYPE, query);
            expect(invites.length).toBe(1);
        }
        {
            var friends = await users.getFriends('id1', query);
            expect(friends.length).toBe(0);
        }
    });

    test('decline invite', async() => {
        await users.addFriend('id1', 'id3', query);

        //id3 declines invite from id1
        await users.deleteInvite('id1', 'id3', users.FRIEND_INVITE_TYPE, query);
        {
            var invites = await users.getInvites('id1', users.FRIEND_INVITE_TYPE, query);
            expect(invites.length).toBe(0);
        }
    });

    test('remove friend', async() => {
        await users.addFriend('id1', 'id2', query);
        await users.addFriend('id2', 'id1', query);
        await users.removeFriend('id2', 'id1', query);
        {
            var friends = await users.getFriends('id1', query);
            expect(friends.length).toBe(0);
        }
    });

    afterEach(async () => {
        await query(`DELETE FROM Invitations`);
        await query(`DELETE FROM Friends`);
        await query(`DELETE FROM Users`);
    });
});

describe('Party', () => {
    beforeEach(async() => {
        await initUsers();
    });

    test('get no party members', async () => {
        var members = await users.getPartyMembers('id1', query);
        expect(members.length).toBe(0);
    });
    
    test('Invite to party', async () => {
        await users.inviteToParty('id1', 'id2', query);
        {
            var invites = await users.getInvites('id1', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(1);
        }
    });

    test('Only accept friend', async () => {
        await users.inviteToParty('id1', 'id2', query);
        var nowFriend = await users.addFriend('id2', 'id1', query);
        expect(nowFriend).toBeTruthy();
        //User should now be friend but invite should not be there
        {
            var members = await users.getPartyMembers('id2', query);
            expect(members.length).toBe(0);
        }
        {
            var friends = await users.getFriends('id2', query);
            expect(friends.length).toBe(1);
        }
        {
            var invites = await users.getInvites('id2', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(1);
        }
    });

    test('Delete party invite', async () => {
        await users.inviteToParty('id1', 'id2', query);
        await users.deleteInvite('id1', 'id2', users.PARTY_INVITE_TYPE, query);
        {
            var invites = await users.getInvites('id2', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(0);
        }
    });

    test('Nonfriend accepts party invite', async() => {
        await users.inviteToParty('id1', 'id2', query);
        await users.acceptPartyInvite('id2', 'id1', query);
        {
            var members = await users.getPartyMembers('id1', query);
            expect(members.length).toBe(2);
        }
        {
            var friends = await users.getFriends('id2', query);
            expect(friends.length).toBe(1);
        }
        {
            var invites = await users.getInvites('id2', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(0);
        }
    });

    test('Friend accepts party invite', async() => {
        await users.addFriend('id1', 'id2', query);
        await users.addFriend('id2', 'id1', query);
        await users.inviteToParty('id1', 'id2', query);
        await users.acceptPartyInvite('id2', 'id1', query);
        {
            var members = await users.getPartyMembers('id1', query);
            expect(members.length).toBe(2);
        }
        {
            var members = await users.getPartyMembers('id2', query);
            expect(members.length).toBe(2);
        }
        {
            var friends = await users.getFriends('id2', query);
            expect(friends.length).toBe(1);
        }
        {
            var invites = await users.getInvites('id2', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(0);
        }
    });

    test('Accept Party Invite with other invites / add friend through party invite', async() => {
        await users.inviteToParty('id1', 'id2', query);
        await users.acceptPartyInvite('id2', 'id1', query);
        await users.inviteToParty('id1', 'id3', query);
        //id2 invite is deleted because its to the same party as id1
        await users.inviteToParty('id2', 'id3', query);
        //id3 invites are deleted when joins another party
        await users.inviteToParty('id3', 'id2', query);
        {
            var invites = await users.getInvites('id1', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(1);
        }
        {
            var invites = await users.getInvites('id2', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(2);
        }
        {
            var invites = await users.getInvites('id3', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(3);
        }
        await users.acceptPartyInvite('id3', 'id1', query);
        {
            var invites = await users.getInvites('id1', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(0);
        }
        {
            var invites = await users.getInvites('id2', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(0);
        }
        {
            var invites = await users.getInvites('id3', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(0);
        }
        {
            var friends = await users.getFriends('id3', query);
            expect(friends.length).toBe(1);
        }
    });

    test('Send party invite to existing member', async() => {
        await users.inviteToParty('id1', 'id2', query);
        await users.acceptPartyInvite('id2', 'id1', query);
        var error = null;
        try {
            await users.inviteToParty('id1', 'id2', query);
        } catch (e) {
            error = e;
        }
        expect(error).toBeTruthy();
        {
            var invites = await users.getInvites('id1', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(0);
        }
    });

    test('Leave Party', async() => {
        await users.inviteToParty('id1', 'id2', query);
        await users.inviteToParty('id1', 'id3', query);
        await users.acceptPartyInvite('id2', 'id1', query);

        await users.leaveParty('id1', query);
        await users.leaveParty('id2', query);
        await users.inviteToParty('id3', 'id1', query);
        await users.inviteToParty('id3', 'id2', query);
        await users.inviteToParty('id1', 'id3', query);
        await users.inviteToParty('id1', 'id2', query);
        await users.leaveParty('id3', query);
        {
            var invites = await users.getInvites('id1', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(2);
        }
        {
            var invites = await users.getInvites('id2', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(1);
        }
        {
            var invites = await users.getInvites('id3', users.PARTY_INVITE_TYPE, query);
            expect(invites.length).toBe(1);
        }
    });

    afterEach(async () => {
        await query(`DELETE FROM Parties`);
        await query(`DELETE FROM Friends`);
        await query(`DELETE FROM Invitations`);
        await query(`DELETE FROM Users`);
    });
});
afterAll(async () => {
    await query(`DROP TABLE DefaultNames`);
    await query(`DROP TABLE Parties`);
    await query(`DROP TABLE Friends`);
    await query(`DROP TABLe Invitations`);
    await query(`DROP TABLE ProfilePictures`);
    await query(`DROP TABLE Users`);
    connection.end();
});