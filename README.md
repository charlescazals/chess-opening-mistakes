# Chess Opening Mistakes Analyzer

Analyze your Chess.com games to identify recurring opening mistakes using Stockfish.

## Features

- Fetches your blitz and rapid games from Chess.com
- Analyzes openings using Stockfish on AWS Lambda
- Identifies recurring mistakes across your games
- Filter by opening, color, impact, and more

## Live Site

Visit [chessmistakes.com](https://chessmistakes.com)

## Architecture

The application runs on AWS with the following components:

- **S3 + CloudFront**: Static website hosting with CDN
- **Lambda**: Runs game analysis using native Stockfish
- **API Gateway**: REST API for analysis requests
- **DynamoDB**: Stores analysis job progress
- **ACM**: TLS certificate for HTTPS

## Local Development

For local frontend development, serve the static files with any HTTP server:

```bash
# Using Python
python3 -m http.server 8000

# Using Node.js
npx serve
```

Note: Local development requires the AWS backend to be deployed for analysis to work.

## Deployment

### Prerequisites

- Node.js 20+
- AWS CLI configured with profile `charlescazalspersonal`
- AWS CDK CLI (`npm install -g aws-cdk`)
- Docker (for Lambda container build)

### Deploy Infrastructure

```bash
# Install CDK dependencies
cd infrastructure
npm install

# Bootstrap CDK (first time only)
cdk bootstrap --profile charlescazalspersonal

# Deploy the certificate stack first (us-east-1)
# Note: This requires DNS validation - add CNAME records when prompted
cdk deploy ChessMistakesCertificateStack --profile charlescazalspersonal

# Deploy the main stack (eu-west-3)
cdk deploy ChessMistakesStack --profile charlescazalspersonal

# Or deploy all stacks
cdk deploy --all --profile charlescazalspersonal
```

### DNS Configuration

After deployment, point your domain to CloudFront:

1. Get the CloudFront distribution domain from the stack outputs
2. Create a CNAME or ALIAS record for `chessmistakes.com` pointing to the CloudFront domain
3. Create a CNAME or ALIAS record for `www.chessmistakes.com` pointing to the same CloudFront domain

### Update Static Files

Static files are automatically deployed via CDK's BucketDeployment. To manually update:

```bash
# Upload files to S3
aws s3 sync . s3://chess-mistakes-website-ACCOUNT_ID \
    --exclude "infrastructure/*" \
    --exclude "lambda/*" \
    --exclude ".git/*" \
    --exclude "node_modules/*" \
    --profile charlescazalspersonal

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
    --distribution-id DISTRIBUTION_ID \
    --paths "/*" \
    --profile charlescazalspersonal
```

### Useful Commands

```bash
# View stack differences before deploying
cdk diff --profile charlescazalspersonal

# Synthesize CloudFormation template
cdk synth --profile charlescazalspersonal

# Destroy all resources (caution!)
cdk destroy --all --profile charlescazalspersonal
```

## How It Works

1. Enter your Chess.com username
2. The app fetches your recent games via the Chess.com API
3. Games are sent to AWS Lambda for Stockfish analysis
4. The first 14 half-moves of each game are analyzed
5. Mistakes (eval drops >= 1 pawn) are grouped by move sequence
6. Browse and filter your recurring opening mistakes

All user data is stored locally in your browser (localStorage).

## Project Structure

```
chess_mistakes/
├── infrastructure/          # AWS CDK infrastructure
│   ├── bin/app.ts          # CDK app entry point
│   ├── lib/                # Stack definitions
│   ├── cdk.json            # CDK configuration
│   └── package.json        # CDK dependencies
├── lambda/                  # Lambda function code
│   ├── Dockerfile          # Container with Stockfish
│   ├── index.js            # Lambda handler
│   └── package.json        # Lambda dependencies
├── static/                  # Frontend assets
│   ├── css/styles.css      # Styles
│   ├── js/                 # JavaScript modules
│   └── img/                # Chess piece images
└── index.html              # Main HTML page
```
