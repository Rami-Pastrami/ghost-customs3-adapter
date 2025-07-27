const StorageBase = require('ghost-storage-base');
const AWS = require('aws-sdk');
const path = require('path');
const { readFileSync } = require('fs');

class CustomS3Adapter extends StorageBase {
    constructor(config) {
        super(config);

        this.bucket = process.env.S3_BUCKET;
        this.region = process.env.S3_REGION;
        this.endpoint = process.env.S3_ENDPOINT;
        this.publicUrl = process.env.S3_PUBLIC_URL;

        this.s3 = new AWS.S3({
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_KEY,
            endpoint: this.endpoint,
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            region: this.region,
        });
    }

    async save(image, targetDir) {
        const filePath = this.getTargetDir(targetDir) + '/' + this.getUniqueFileName(image, targetDir);
        const fileContent = readFileSync(image.path);

        await this.s3.putObject({
            Bucket: this.bucket,
            Key: filePath,
            Body: fileContent,
            ContentType: image.type,
            ACL: 'public-read',
        }).promise();

        return `${this.publicUrl}/${filePath}`;
    }

    exists(filename, targetDir) {
        return Promise.resolve(false);
    }

    delete(filename, targetDir) {
        const filePath = path.join(targetDir || '', filename);

        return this.s3.deleteObject({
            Bucket: this.bucket,
            Key: filePath,
        }).promise();
    }

    serve() {
        return (req, res, next) => next();
    }

    read(options) {
        return this.s3.getObject({
            Bucket: this.bucket,
            Key: options.path,
        }).promise().then(data => data.Body);
    }
}

module.exports = CustomS3Adapter;
