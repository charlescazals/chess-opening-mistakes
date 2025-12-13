#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ChessMistakesStack } from '../lib/chess-mistakes-stack';
import { CertificateStack } from '../lib/certificate-stack';

const app = new cdk.App();

// Certificate must be in us-east-1 for CloudFront
const certificateStack = new CertificateStack(app, 'ChessMistakesCertificateStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  crossRegionReferences: true,
  domainName: 'chessmistakes.com',
});

// Main stack in eu-west-3
const mainStack = new ChessMistakesStack(app, 'ChessMistakesStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-west-3',
  },
  crossRegionReferences: true,
  certificate: certificateStack.certificate,
  domainName: 'chessmistakes.com',
});

mainStack.addDependency(certificateStack);
