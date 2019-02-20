var stream = require('stream');
var sharp = require('sharp');

//Upload to S3 bucket from the returned passthrough steam
function uploadFromStream(bucket, key, s3Client, publicObj = false) {
    var bufferStream = new stream.PassThrough();
    
    var promise = new Promise((resolve, reject) => {
        var params = {Bucket: bucket, Key: key, Body: bufferStream};
        if (publicObj) { 
            params["ACL"] = 'public-read';
        }
        s3Client.upload(params, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
    return {"promise": promise, "stream": bufferStream};
}

async function uploadImageDataOfSizes(data, imgSizes, bucket, objKeyPrefix, s3Client, publicObj = false) {
    var bufferStream = new stream.PassThrough();
    bufferStream.end(new Buffer(data));

    await uploadImageStreamOfSizes(bufferStream, imgSizes, bucket, objKeyPrefix, s3Client, publicObj);
}

//Upload all variations of ride image to s3
async function uploadImageStreamOfSizes(stream, imgSizes, bucket, objKeyPrefix, s3Client, publicObj = false) {
    var promises = [];

    imgSizes.forEach((imgSize, i) => {
        var imgTransformer =
            sharp()
            .resize(imgSize)
            .webp();
        var key = objKeyPrefix + "-" + i + '.webp';
        var upload = uploadFromStream(bucket, key, s3Client, publicObj);
        promises.push(upload.promise);
        stream.pipe(imgTransformer).pipe(upload.stream);
    });
    await Promise.all(promises);
}

module.exports = {
    uploadImageDataOfSizes: uploadImageDataOfSizes,
    uploadImageStreamOfSizes: uploadImageStreamOfSizes
};