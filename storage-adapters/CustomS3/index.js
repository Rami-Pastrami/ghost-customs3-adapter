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

        // Read configuration from environment variables
        // Expected formats and examples:
        
        // S3_BUCKET: Just the bucket name (string)
        // Examples: "my-blog-images", "ghost-uploads", "content"
        this.bucket = process.env.S3_BUCKET;
        
        // S3_REGION: AWS region code (string)
        // Examples: "us-east-1", "eu-west-1", "ap-southeast-1"
        // Note: For non-AWS services like MinIO, any valid region works
        this.region = process.env.S3_REGION;
        
        // S3_PUBLIC_URL: Full public URL that browsers will use to access images (string with protocol)
        // Examples: 
        //   AWS S3: "https://my-bucket.s3.amazonaws.com" or "https://my-bucket.s3.us-east-1.amazonaws.com"
        //   MinIO: "http://localhost:9000/my-bucket" or "https://minio.example.com/my-bucket"
        //   DigitalOcean: "https://my-space.nyc3.digitaloceanspaces.com"
        this.publicUrl = process.env.S3_PUBLIC_URL;
        
        // S3_ACCESS_KEY: Access key ID (string)
        // Examples:
        //   AWS: "AKIAIOSFODNN7EXAMPLE"
        //   MinIO default: "minioadmin"
        this.accessKeyId = process.env.S3_ACCESS_KEY;
        
        // S3_SECRET_KEY: Secret access key (string)
        // Examples:
        //   AWS: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
        //   MinIO default: "minioadmin"
        this.secretAccessKey = process.env.S3_SECRET_KEY;

        // Smart endpoint detection for S3 API calls
        // Priority: S3_ENDPOINT (explicit) > auto-derive from S3_PUBLIC_URL > default to AWS
        if (process.env.S3_ENDPOINT) {
            // S3_ENDPOINT: Full endpoint URL for S3 API calls (string with protocol)
            // Examples:
            //   AWS: Not needed (will auto-default)
            //   MinIO: "http://localhost:9000" or "https://minio.example.com"
            //   DigitalOcean: "https://nyc3.digitaloceanspaces.com"
            this.endpoint = process.env.S3_ENDPOINT;
        } else if (this.publicUrl) {
            // Auto-derive endpoint from S3_PUBLIC_URL
            // Extracts protocol and host from public URL
            // Example: "http://localhost:9000/bucket" -> "http://localhost:9000"
            try {
                const url = new URL(this.publicUrl);
                this.endpoint = `${url.protocol}//${url.host}`;
                console.log(`Auto-derived S3_ENDPOINT from S3_PUBLIC_URL: ${this.endpoint}`);
            } catch (error) {
                throw new Error(`Invalid S3_PUBLIC_URL format: ${this.publicUrl}. Expected format: http://host:port/bucket-name`);
            }
        } else {
            // Default to AWS S3 endpoint if no explicit endpoint and no public URL to derive from
            this.endpoint = `https://s3.${this.region}.amazonaws.com`;
        }

        // Log configuration for debugging (without exposing secrets)
        console.log('S3 Adapter Configuration:');
        console.log(`  Bucket: ${this.bucket}`);
        console.log(`  Region: ${this.region}`);
        console.log(`  Endpoint: ${this.endpoint} ${process.env.S3_ENDPOINT ? '(explicit)' : '(auto-derived)'}`);
        console.log(`  Public URL: ${this.publicUrl}`);
        console.log(`  Access Key: ${this.accessKeyId ? `${this.accessKeyId.substring(0, 4)}...` : 'NOT SET'}`);
        console.log(`  Secret Key: ${this.secretAccessKey ? 'SET' : 'NOT SET'}`);

        // Validate that all required configuration is present
        if (!this.bucket || !this.region || !this.publicUrl || !this.accessKeyId || !this.secretAccessKey) {
            throw new Error(`Missing required S3 configuration. Please check your environment variables:
                S3_BUCKET: ${this.bucket ? 'SET' : 'MISSING'}
                S3_REGION: ${this.region ? 'SET' : 'MISSING'}
                S3_ENDPOINT: ${this.endpoint} (${process.env.S3_ENDPOINT ? 'explicit' : 'auto-derived from S3_PUBLIC_URL'})
                S3_PUBLIC_URL: ${this.publicUrl ? 'SET' : 'MISSING'}
                S3_ACCESS_KEY: ${this.accessKeyId ? 'SET' : 'MISSING'}
                S3_SECRET_KEY: ${this.secretAccessKey ? 'SET' : 'MISSING'}`);
        }

        // Configure the AWS S3 client
        const s3Config = {
            region: this.region,
            credentials: {
                accessKeyId: this.accessKeyId,
                secretAccessKey: this.secretAccessKey
            },
            forcePathStyle: true, // Required for MinIO and some S3-compatible services
        };

        // Set endpoint for non-AWS services (AWS uses default endpoints)
        if (this.endpoint) {
            s3Config.endpoint = this.endpoint;
        }

        console.log(`Creating S3 client with endpoint: ${this.endpoint}`);
        
        this.s3 = new S3Client(s3Config);
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
