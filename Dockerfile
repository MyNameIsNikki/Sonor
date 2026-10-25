# Dockerfile for Sonor Music Player development
FROM node:18-alpine

# Install dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    openssh

# Create app directory
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copy app files
COPY . .

# Expose port
EXPOSE 19006

# Start the app
CMD ["npm", "start"]