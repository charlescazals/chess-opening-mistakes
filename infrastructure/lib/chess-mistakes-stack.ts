import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { Construct } from 'constructs';

interface ChessMistakesStackProps extends cdk.StackProps {
  certificate: acm.ICertificate;
  domainName: string;
}

export class ChessMistakesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ChessMistakesStackProps) {
    super(scope, id, props);

    // DynamoDB table for storing analysis job progress
    const jobsTable = new dynamodb.Table(this, 'AnalysisJobsTable', {
      tableName: 'chess-mistakes-jobs',
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda function for game analysis using Docker container with Stockfish
    const analysisLambda = new lambda.DockerImageFunction(this, 'AnalysisFunction', {
      functionName: 'chess-mistakes-analyzer',
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '../../lambda')),
      memorySize: 2048,
      timeout: cdk.Duration.minutes(15),
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
      },
      architecture: lambda.Architecture.X86_64,
    });

    // Grant Lambda access to DynamoDB
    jobsTable.grantReadWriteData(analysisLambda);

    // API Gateway REST API
    const api = new apigateway.RestApi(this, 'AnalysisApi', {
      restApiName: 'Chess Mistakes Analysis API',
      description: 'API for analyzing chess games using Stockfish',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(analysisLambda);

    // API routes
    const apiResource = api.root.addResource('api');

    // POST /api/analyze - Start analysis
    const analyzeResource = apiResource.addResource('analyze');
    analyzeResource.addMethod('POST', lambdaIntegration);

    // GET /api/status/{jobId} - Get job status
    const statusResource = apiResource.addResource('status');
    const jobIdResource = statusResource.addResource('{jobId}');
    jobIdResource.addMethod('GET', lambdaIntegration);

    // S3 bucket for static website hosting
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `chess-mistakes-website-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Origin Access Identity for CloudFront to access S3
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for Chess Mistakes website',
    });

    // Grant CloudFront access to S3
    websiteBucket.grantRead(originAccessIdentity);

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      domainNames: [props.domainName, `www.${props.domainName}`],
      certificate: props.certificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // Deploy static assets to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../'), {
        exclude: [
          'infrastructure/**',
          'lambda/**',
          '.git/**',
          '.cursor/**',
          'node_modules/**',
          'coi-serviceworker.js',
          'static/js/stockfish.js',
        ],
      })],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // Outputs
    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: `https://${props.domainName}`,
      description: 'Website URL',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'CloudFront distribution domain (point DNS here)',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'S3BucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 bucket name for manual uploads',
    });
  }
}
