var config = require('./config');
var userManager = require('../core/User');
var commons = require('./Commons');

var query = commons.getDatabaseQueryMethod();

/*
body: {
    name: String? (chosen username)
}
*/
async function createUser(body, userID) {
    var name = body["name"];
    return await userManager.createUser(userID, name, query);
}

/*
body: {
    name: String? (new username)
}
*/
async function renameUser(body, userID) {
    var name = body["name"];
    
    await userManager.renameUser(userID, name, query);
}

/*
objKey: String (key of uploaded profile picture)
bucket: String (bucket profile picture is found in)
*/
async function updateProfilePic(bucket, objKey) {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});

    var s3 = new AWS.S3();
    var sns = new AWS.SNS();

    try {
        var userID = objKey.substr(objKey.find('/') + 1);
        userID = userID.substr(0, userID.indexOf('/'));
        var profilePicPrefix = await userManager.updateProfilePic(userID, bucket, objKey, query, s3);
        await commons.sendSNS(userID, "updateProfilePic", { profilePicUrl: profilePicPrefix }, sns);
    } catch (e) {
        await commons.sendSNS(userID, "updateProfilePicErr", { message: e.message }, sns);
    }
}

/*
body: {
    userID: String?
}
--
{
    id,
    name,
    profilePicUrl
}
*/
async function getUser(body, userID) {
    var chosenUserID = body["userID"];
    if (chosenUserID != null) {
        userID = chosenUserID;
    }
    return await userManager.getUser(userID, query);
}

/*
body: {
    prefix: String (term to search username for)
}
--
[
    {
        id,
        name,
        profilePicUrl
    }
]
*/
async function searchUsers(body, userID) {
    var prefix = body["prefix"];
    return await userManager.searchUsers(prefix, userID, query);
}

/*
--
[
    {
        isOwner,
        isFriend,
        type,
        user: {
            id,
            name,
            profilePicUrl
        }
    }
]
*/
async function getInvites(_, userID) {
    var invites = await userManager.getInvites(userID, null, query);
    return invites;
}

/*
body: {
    friendID: String (userID of friend to add)
}
--
bool: indicates if now a friend
*/
async function addFriend(body, userID) {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});
    var sns = new AWS.SNS();

    var friendID = body["friendID"];
    var isFriend = await userManager.addFriend(userID, friendID, query);
    var user = await userManager.getUser(userID, query);
    await commons.sendSNS(friendID, "addFriend", { user: user, isFriend: isFriend }, sns);
}

/*
body: {
    friendID: String (userID of friend to remove)
}
*/
async function removeFriend(body, userID) {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});
    var sns = new AWS.SNS();

    var friendID = body["friendID"];
    await userManager.removeFriend(userID, friendID, query);
    await commons.sendSNS(friendID, "removeFriend", { userID: userID }, sns);
}

/*
--
[
    {
        id,
        name,
        profilePicUrl
    }
]
*/
async function getPartyMembers(_, userID) {
    var partyMembers = await userManager.getPartyMembers(userID, query);
    return partyMembers;
}

/*
body: {
    memberID: String
}
*/
async function inviteToParty(body, userID) {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});
    var sns = new AWS.SNS();

    var memberID = body["memberID"];
    await userManager.inviteToParty(userID, memberID, query);
    var user = await userManager.getUser(userID, query);
    var isFriend = await userManager.areFriends(userID, [memberID], query);
    await commons.sendSNS(memberID, "inviteToParty", { user: user, isFriend: isFriend }, sns);
}

/*
body: {
    inviterID: String
}
--
[
    {
        id,
        name,
        profilePicUrl
    }
]
*/
async function acceptPartyInvite(body, userID) {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});
    var sns = new AWS.SNS();

    var inviterID = body["inviterID"];
    var oldPartyMembers = await userManager.getPartyMembers(userID, query);
    await userManager.acceptPartyInvite(userID, inviterID, query);
    var user = await userManager.getUser(userID, query);

    var partyMembers = await userManager.getPartyMembers(userID, query);
    var promises = [];
    for (var oldPartyMember of oldPartyMembers) {
        if (oldPartyMember.id != userID) {
            promises.push(
                commons.sendSNS(oldPartyMember.id, "leaveParty", { userID: userID }, sns)
            );
        }
    }
    for (var partyMember of partyMembers) {
        if (partyMember.id != userID) {
            promises.push(
                commons.sendSNS(partyMember.id, "acceptPartyInvite", { user: user }, sns)
            );
        }
    }
    if (promises.length > 0) {
        await Promise.all(promises);
    }
    return partyMembers;
}

async function leaveParty(_, userID) {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});
    var sns = new AWS.SNS();

    await userManager.leaveParty(userID, query);

    var partyMembers = await userManager.getPartyMembers(userID, query);
    var promises = [];
    for (var partyMember of partyMembers) {
        if (partyMember.id != userID) {
            promises.push(
                commons.sendSNS(partyMember.id, "leaveParty", { userID: userID }, sns)
            );
        }
    }
    if (promises.length > 0) {
        await Promise.all(promises);
    }
}

/*
body: {
    type,
    isOwner,
    userID
}
*/
async function deleteInvite(body, userID) {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});
    var sns = new AWS.SNS();
    
    var isOwner = body["isOwner"];
    var otherUserID = body["userID"];
    var type = body["type"];
    var ownerID = (isOwner)? userID: otherUserID;
    var receiverID = (isOwner)? otherUserID: userID;
    await userManager.deleteInvite(ownerID, receiverID, type, query);
    await commons.sendSNS(otherUserID, "deleteInvite", {
        isOwner: !isOwner,
        userID: userID,
        type: type
    }, sns);
}

async function verifySns(body, userID) {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});
    var sns = new AWS.SNS();
    var token = body["token"];
    var endpointArn = body["endpointArn"];
    if (endpointArn == null) {
        endpointArn = await createSnsComponents(userID, token, sns);
    }
    try {
        var getEndpointResult = await sns.getEndpointAttributes({
            EndpointArn: endpointArn
        }).promise();
        if (getEndpointResult.Attributes["Token"] != token || getEndpointResult.Attributes["Enabled"] != "true") {
            await sns.setEndpointAttributes({
                EndpointArn: endpointArn,
                Attributes: {
                    "Token": token,
                    "Enabled": "true"
                }
            });
        }
    } catch (err) {
        console.log("GET ENDPOINT ERR: ", err);
        endpointArn = await createSnsComponents(userID, token, sns);
    }
    return endpointArn;
}

async function createSnsComponents(userID, token, sns) {
    var topicName = userID.substr(userID.indexOf(':') + 1);
    var createTopicResult = await sns.createTopic({
        Name: topicName
    }).promise();
    var topicArn = createTopicResult.TopicArn;

    var createEndpointResult = await sns.createPlatformEndpoint({
        PlatformApplicationArn: config.sns.platformArn,
        Token: token
    }).promise();
    var endpointArn = createEndpointResult.EndpointArn;

    await sns.subscribe({
        Endpoint: endpointArn,
        Protocol: 'application',
        TopicArn: topicArn
    });

    return endpointArn;
}

module.exports = {
    createUser: createUser,
    renameUser: renameUser,
    updateProfilePic: updateProfilePic,
    getUser: getUser,
    searchUsers: searchUsers,
    getInvites: getInvites,
    addFriend: addFriend,
    removeFriend: removeFriend,
    getPartyMembers: getPartyMembers,
    inviteToParty: inviteToParty,
    acceptPartyInvite: acceptPartyInvite,
    leaveParty: leaveParty,
    deleteInvite: deleteInvite,
    verifySns: verifySns
}