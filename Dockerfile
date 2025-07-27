# ghost-customs3-adapter/Dockerfile
FROM ghost:5-alpine

# Copy storage adapter into the Ghost content directory
COPY storage-adapters/CustomS3/ /var/lib/ghost/content/adapters/storage/CustomS3/

# Install adapter dependencies
WORKDIR /var/lib/ghost/content/adapters/storage/CustomS3
RUN npm install --production

# Return to Ghost working directory
WORKDIR /var/lib/ghost