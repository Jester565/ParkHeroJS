var userAPI = require('./api/UserApi');
var rideAPI = require('./api/RideApi');
var modules = {
    users: userAPI,
    rides: rideAPI
};

function s3Handler(event, context, callback) {
    var bucket = event['Records'][0]['s3']['bucket']['name'];
    var objKey = decodeURIComponent(event['Records'][0]['s3']['object']['key']);
    if (objKey.indexOf('tmpProfileImgs') == 0) {
        userAPI.updateProfilePic(bucket, objKey).then(() => {
            callback();
        }).catch((err) => {
            console.error("updateProfilePic error occured: ", err);
            callback(err); 
        });
    }
}

function snsHandler(event, context, callback) {
    var body = JSON.parse(event.Records[0].Sns.Message);
    rideAPI.updateRides(body);
}

function graphQLHandler(event, context, callback) {
    var moduleName = event["module"];
    var methodName = event["method"];
    var body = event.arguments;
    var userID = event.cognitoIdentityId;
    modules[moduleName][methodName](body, userID).then((data) => {
        callback(null, data);
    }).catch((err) => {
        console.warn("ERROR OCCURED in " + moduleName + "." + methodName + ": ", err);
        callback(err);
    });
}

function handler(event, context, callback) {
    context.callbackWaitsForEmptyEventLoop = false;

    if (event['Records'] != null
        && event['Records'].length > 0
        && event['Recrods'][0] == 's3') 
    {
        s3Handler(event, context, callback);
    } 
    else if (event['Records'] != null
        && event['Records'].length > 0
        && event['Recrods'][0] == 'sns') 
    {
        snsHandler(event, context, callback);    
    } 
    else 
    {
        graphQLHandler(event, context, callback);
    }
}