const StorageBase = require('ghost-storage-base');
const path = require('path');
const { readFileSync } = require('fs');
const {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand
} = require('@aws-sdk/client-s3');

class CustomS3Adapter extends StorageBase {
    constructor(config = {}) {
        super(config);

        // Read from the user's existing environment variable names
        this.bucket = process.env.S3_BUCKET;
        this.region = process.env.S3_REGION;
        // Default to AWS S3 endpoint if not provided
        this.endpoint = process.env.S3_ENDPOINT || `https://s3.${process.env.S3_REGION}.amazonaws.com`;
        this.publicUrl = process.env.S3_PUBLIC_URL;
        this.accessKeyId = process.env.S3_ACCESS_KEY;
        this.secretAccessKey = process.env.S3_SECRET_KEY;

        // Validate required configuration
        if (!this.bucket || !this.region || !this.publicUrl || !this.accessKeyId || !this.secretAccessKey) {
            throw new Error(`Missing required S3 configuration. Please check your environment variables:
                S3_BUCKET: ${this.bucket ? 'SET' : 'MISSING'}
                S3_REGION: ${this.region ? 'SET' : 'MISSING'}
                S3_ENDPOINT: ${this.endpoint} (using default AWS if not set)
                S3_PUBLIC_URL: ${this.publicUrl ? 'SET' : 'MISSING'}
                S3_ACCESS_KEY: ${this.accessKeyId ? 'SET' : 'MISSING'}
                S3_SECRET_KEY: ${this.secretAccessKey ? 'SET' : 'MISSING'}`);
        }

        this.s3 = new S3Client({
            region: this.region,
            endpoint: this.endpoint,
            credentials: {
                accessKeyId: this.accessKeyId,
                secretAccessKey: this.secretAccessKey
            },
            forcePathStyle: true
        });
    }

    async save(image, targetDir) {
        const filePath = this.getTargetDir(targetDir) + '/' + this.getUniqueFileName(image, targetDir);
        const fileContent = readFileSync(image.path);

        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: filePath,
            Body: fileContent,
            ContentType: image.type,
            ACL: 'public-read'
        });

        await this.s3.send(command);
        return `${this.publicUrl}/${filePath}`;
    }

    async exists(filename, targetDir) {
        const filePath = path.posix.join(targetDir || '', filename);
        try {
            const command = new HeadObjectCommand({
                Bucket: this.bucket,
                Key: filePath
            });
            await this.s3.send(command);
            return true;
        } catch (err) {
            if (err.name === 'NotFound') return false;
            throw err;
        }
    }

    async delete(filename, targetDir) {
        const filePath = path.posix.join(targetDir || '', filename);
        const command = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: filePath
        });
        await this.s3.send(command);
        return true;
    }

    serve() {
        return (req, res, next) => next();
    }

    async read(options) {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: options.path
        });

        const data = await this.s3.send(command);
        return data.Body;
    }
}

module.exports = CustomS3Adapter;
