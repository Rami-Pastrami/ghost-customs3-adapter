const StorageBase = require('ghost-storage-base');
const path = require('path');
const { readFile } = require('fs').promises;
const Minio = require('minio');

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
        this.region = process.env.S3_REGION || 'us-east-1';
        
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

		// S3_ENDPOINT: Full endpoint URL for S3 API calls (string with protocol)
		// Examples:
		//   AWS: 
		//   MinIO: "http://localhost:9000" or "https://minio.example.com"
		//   DigitalOcean: "https://nyc3.digitaloceanspaces.com"
		this.endpoint = process.env.S3_ENDPOINT;

        // Parse endpoint for MinIO client
        let endpointHost, port, useSSL;
        if (this.endpoint) {
            try {
                const url = new URL(this.endpoint);
                endpointHost = url.hostname;
                port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
                useSSL = url.protocol === 'https:';
            } catch (error) {
                throw new Error(`Invalid endpoint format: ${this.endpoint}`);
            }
        } else {
            // AWS defaults
            endpointHost = `s3.${this.region}.amazonaws.com`;
            port = 443;
            useSSL = true;
        }

        // Detect if we're using MinIO or another non-AWS service
        this.isAWS = endpointHost.includes('amazonaws.com');

        // Validate that all required configuration is present
        if (!this.bucket || !this.accessKeyId || !this.secretAccessKey || !this.publicUrl || !this.endpoint) {
            throw new Error(`Missing required S3 configuration. Please check your environment variables:
                S3_BUCKET: ${this.bucket ? 'SET' : 'MISSING'}
                S3_REGION: ${this.region}
                S3_ENDPOINT: ${this.endpoint} (${process.env.S3_ENDPOINT ? 'explicit' : 'auto-derived from S3_PUBLIC_URL'})
                S3_PUBLIC_URL: ${this.publicUrl ? 'SET' : 'MISSING'}
                S3_ACCESS_KEY: ${this.accessKeyId ? 'SET' : 'MISSING'}
				S3_ENDPOINT: ${this.endpoint ? 'SET' : 'MISSING'}
                S3_SECRET_KEY: ${this.secretAccessKey ? 'SET' : 'MISSING'}`);
        }

        this.minioClient = new Minio.Client({
            endPoint: endpointHost,
            port: port,
            useSSL: useSSL,
            accessKey: this.accessKeyId,
            secretKey: this.secretAccessKey,
            region: this.region
        });
    }

    async save(uploadingFile, targetDir) {
        try {
            
			const directory = targetDir || this.getTargetDir(this.pathPrefix)
			const filePath = this.getTargetDir(targetDir) + '/' + this.getUniqueFileName(uploadingFile, directory);
            
            const fileContent = await readFile(uploadingFile.path);

            const metaData = {
                'Content-Type': uploadingFile.type,
				'Cache-Control': `max-age=${60 * 60 * 24 * 7}`, // 7 days
            };

            // Upload using MinIO SDK
            await this.minioClient.putObject(
                this.bucket,
                filePath,
                fileContent,
                fileContent.length,
                metaData
            );
            
            const resultUrl = `${this.publicUrl}/${filePath}`;
            console.log(`Successfully uploaded file, accessible at: ${resultUrl}`);
            return resultUrl;
        } catch (error) {
            console.error('Error uploading file to S3:', error);
            console.error('Error details:', {
                message: error.message,
                code: error.code,
                statusCode: error.statusCode
            });
            
            // Provide helpful debugging info
            if (error.code === 'InvalidAccessKeyId' || error.code === 'SignatureDoesNotMatch') {
                console.error('CREDENTIALS ERROR:');
                console.error('- Check your S3_ACCESS_KEY and S3_SECRET_KEY are correct');
                console.error('- Ensure no extra spaces or special characters in credentials');
                console.error('- Verify MinIO server is accessible and credentials are valid');
            } else if (error.code === 'NoSuchBucket') {
                console.error('BUCKET ERROR:');
                console.error(`- Bucket "${this.bucket}" does not exist`);
                console.error('- Create the bucket in MinIO first');
            } else if (error.code === 'ENOENT') {
                console.error('FILE ERROR:');
                console.error(`- Temporary file not found: ${uploadingFile.path}`);
                console.error('- Ghost may have cleaned up the temp file too early');
            }
            
            throw error;
        }
    }

    async exists(filename, targetDir) {
        const filePath = path.posix.join(targetDir || '', filename);
        try {
            
            await this.minioClient.statObject(this.bucket, filePath);
            return true;
        } catch (err) {
            if (err.code === 'NotFound' || err.code === 'NoSuchKey') {
                return false;
            }
            throw err;
        }
    }

    async delete(filename, targetDir) {
        try {
            const filePath = path.posix.join(targetDir || '', filename);
            
            await this.minioClient.removeObject(this.bucket, filePath);
            console.log(`Successfully deleted file: ${filePath}`);
            return true;
        } catch (error) {
            console.error('Error deleting file from S3:', error);
            throw error;
        }
    }

    serve() {
        return (req, res, next) => next();
    }

    async read(options) {
        try {
            console.log(`Reading file: ${options.path} from bucket: ${this.bucket}`);
            
            // MinIO SDK's getObject returns a readable stream
            const stream = await this.minioClient.getObject(this.bucket, options.path);
            return stream;
        } catch (error) {
            console.error('Error reading file from S3:', error);
            throw error;
        }
    }
}

module.exports = CustomS3Adapter;
