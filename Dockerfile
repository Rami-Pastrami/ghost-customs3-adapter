# ghost-customs3-adapter/Dockerfile
FROM ghost:5-alpine

# Copy storage adapter into the Ghost content directory
RUN mkdir -p /var/lib/ghost/content/adapters/storage/CustomS3
COPY storage-adapters/CustomS3/ /var/lib/ghost/content/adapters/storage/CustomS3/

# Install AWS SDK
WORKDIR /var/lib/ghost/content/adapters/storage/CustomS3
RUN npm install --production