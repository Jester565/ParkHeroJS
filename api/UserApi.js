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
    name: String? (chosen username),
    imgUri: String? (new profile pic)
}
--
{
    user: {
        id
        name
        profilePicUrl
    }
    errors: [STRING]
}
*/
async function updateUser(body, userID) {
    var username = body["name"];
    var imgUri = body["imgUri"];
    var promises = [];
    if (username != null) {
        promises.push(userManager.renameUser(userID, username, query));
    }
    if (imgUri != null) {
        var AWS = require('aws-sdk');
        AWS.config.update({region: config.region});
        var s3 = new AWS.S3();
        
        const vision = require('@google-cloud/vision');
        const imageAnnotatorClient = new vision.ImageAnnotatorClient({
        	keyFile: config.google.configFile
        });
        
        promises.push(userManager.updateProfilePic(userID, imgUri, config.s3.bucket, query, s3, imageAnnotatorClient));
    }
    
    var errors = [];
    for (var promise of promises) {
        try {
            await promise;
        } catch (err) {
            console.log("ERR: ", JSON.stringify(err));
            errors.push(JSON.stringify(err));
        }
    }
    var user = await userManager.getUser(userID, query);
    
    return {
        user: user,
        errors: errors
    };
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
    return isFriend;
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

async function getFriends(_, userID) {
    return await userManager.getFriends(userID, query);
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
    return isFriend;
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
    var givenEndpointArn = body["endpointArn"];
    var endpointArn = body["endpointArn"];
    var subscriptionArn = body["subscriptionArn"];
    var endpointUserID = body["endpointUserID"];
    
    if (endpointArn == null) {
        var createEndpointResult = await sns.createPlatformEndpoint({
            PlatformApplicationArn: config.sns.platformArn,
            Token: token
        }).promise();
        endpointArn = createEndpointResult.EndpointArn;
    }
    if (userID != endpointUserID && subscriptionArn != null) {
        await sns.unsubscribe({
            SubscriptionArn: subscriptionArn
        }).promise();
    }
    if (userID != endpointUserID || givenEndpointArn == null) {
        var topicName = userID.substr(userID.indexOf(':') + 1);
        var createTopicResult = await sns.createTopic({
            Name: topicName
        }).promise();
        var topicArn = createTopicResult.TopicArn;
        
        var subscribeResult = await sns.subscribe({
            Endpoint: endpointArn,
            Protocol: 'application',
            TopicArn: topicArn,
            ReturnSubscriptionArn: true
        }).promise();
        subscriptionArn = subscribeResult.SubscriptionArn;
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
            }).promise();
        }
    } catch (err) {
        console.log("GET ENDPOINT ERR: ", err);
    }
    return {
        endpointArn: endpointArn,
        subscriptionArn: subscriptionArn
    };
}

module.exports = {
    createUser: createUser,
    updateUser: updateUser,
    getUser: getUser,
    searchUsers: searchUsers,
    getInvites: getInvites,
    addFriend: addFriend,
    removeFriend: removeFriend,
    getFriends: getFriends,
    getPartyMembers: getPartyMembers,
    inviteToParty: inviteToParty,
    acceptPartyInvite: acceptPartyInvite,
    leaveParty: leaveParty,
    deleteInvite: deleteInvite,
    verifySns: verifySns
};