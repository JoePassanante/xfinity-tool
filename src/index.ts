#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { Command } from 'commander';
import ConfigurationStorage from 'conf';

export interface XfinityError {
  error?: string;
}

export interface XfinityUsage {
  accountNumber?: string;
  courtesyUsed?: number;
  courtesyRemaining?: number;
  courtesyAllowed?: number;
  inPaidOverage?: boolean;
  displayUsage?: boolean;
  usageMonths?: UsageMonth[];
}

export interface UsageMonth {
  policyName?: string;
  startDate?: string;
  endDate?: string;
  homeUsage?: number;
  wifiUsage?: number;
  totalUsage?: number;
  allowableUsage?: number;
  unitOfMeasure?: string;
  displayUsage?: boolean;
  devices?: Device[];
  additionalBlocksUsed?: number;
  additionalCostPerBlock?: number;
  additionalUnitsPerBlock?: number;
  additionalIncluded?: number;
  additionalUsed?: number;
  additionalPercentUsed?: number;
  additionalRemaining?: number;
  billableOverage?: number;
  overageCharges?: number;
  overageUsed?: number;
  currentCreditAmount?: number;
  maxCreditAmount?: number;
  policy?: string;
}

export interface Device {
  id?: string;
  usage?: number;
  policyName?: string;
}

const superLazyDelay = () => {
  return new Promise((resolve) => setTimeout(() => resolve(null), 5000));
};

function getXfinityUsage(
  email: string,
  password: string,
  debug?: boolean
): Promise<XfinityUsage & XfinityError> {
  return new Promise(async (resolve, reject) => {
    const browser = await puppeteer.launch({ headless: !(debug || false) });
    const page = await browser.newPage();
    page.setRequestInterception(true);

    page.on('response', async (response) => {
      if (
        response
          .url()
          .includes(
            'https://customer.xfinity.com/apis/csp/account/me/services/internet/usage?filter=internet'
          )
      ) {
        resolve(await response.json());
        page.close();
      }
    });

    page.on('request', (request) => {
      const url = request.url().toLowerCase();
      const resourceType = request.resourceType();

      if (request.resourceType() === 'image') {
        request.abort();
        return;
      }

      if (
        url.includes('adobedtm') ||
        url.includes('demdex') ||
        url.includes('quantummetric')
      ) {
        request.abort();
        return;
      }

      if (
        resourceType == 'media' ||
        url.endsWith('.mp4') ||
        url.endsWith('.avi') ||
        url.endsWith('.flv') ||
        url.endsWith('.mov') ||
        url.endsWith('.wmv')
      ) {
        request.abort();
      } else request.continue();
    });
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.157 Safari/537.36'
    );
    await page.goto('https://login.xfinity.com/login');
    await (() => {
      return new Promise((resolve) => setTimeout(() => resolve(null), 5000));
    })();
    await page.type('#user', email);
    await Promise.all([
      page.click('#sign_in'),
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
    ]);
    await superLazyDelay();
    await page.type('#passwd', password);
    await Promise.all([
      page.click('#sign_in'),
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
    ]);
    await page.goto('https://customer.xfinity.com/#/devices#usage');
    await Promise.all([superLazyDelay()]);
    try {
      await page.type('#passwd', password);
      await Promise.all([
        page.click('#sign_in'),
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        superLazyDelay(),
      ]);
    } catch (err) {}
    await page.goto(
      'https://customer.xfinity.com/apis/csp/account/me/services/internet/usage?filter=internet'
    );
    await browser.close();
    reject(new Error('API Call failed'));
  });
}

const conf = new ConfigurationStorage<Record<string, string>>();

function authFlow(
  email?: string,
  password?: string,
  save?: boolean
): [string, string] | null {
  const fallbackEmail: string | undefined = email || conf.get('email');
  const fallbackPassword: string | undefined = password || conf.get('password');

  const hasEmail = fallbackEmail?.length > 0 || fallbackEmail != null;
  const hasPassword = fallbackPassword?.length > 0 || fallbackPassword != null;

  if (!hasEmail && hasPassword) {
    program.error('Missing email with passowrd');
  }

  if (hasEmail && !hasPassword) {
    program.error('Missing password with email');
  }

  if (!hasEmail || !hasPassword) {
    return null;
  }

  if (save) {
    conf.set('email', fallbackEmail);
    conf.set('password', fallbackPassword);
  }

  return [fallbackEmail as string, fallbackPassword as string];
}

const usage = new Command();
usage
  .name('usage')
  .description('Get the amount of usage left for this pay period')
  .option('--json', 'Output has JSON')
  .option('--show', 'Show the chrome browser getting scrapped', false)
  .action(() => {
    const options = program.opts();
    const usageOptions = usage.opts();

    const auth = authFlow(options.email, options.password, options.save);
    if (auth == null) {
      program.error('Missing with credentails');
    }
    const [email, password] = auth as [string, string];
    getXfinityUsage(email, password, usageOptions.show)
      .then((result) => {
        const lastest = result.usageMonths?.pop();
        const error = result.error;
        if (lastest == null) {
          throw new Error(error);
        }
        const friendly = (
          (((lastest?.allowableUsage as number) -
            (lastest?.totalUsage as number)) /
            (lastest?.allowableUsage as number)) *
          100
        ).toFixed(3);

        if (usageOptions.json) {
          console.log(
            JSON.stringify({
              totalUsage: lastest?.totalUsage,
              allowableUsage: lastest?.allowableUsage,
              remaining:
                (lastest?.allowableUsage as number) -
                (lastest?.totalUsage as number),
            })
          );
          return;
        }

        console.log(
          `${lastest?.totalUsage} GB / ${lastest?.allowableUsage} GB (${friendly}% remaining)`
        );
      })
      .catch((err) => {
        program.error(
          `Failed to get usage details due to: ${
            typeof err === 'string'
              ? err
              : err instanceof Error
              ? err?.message
              : 'Unknown'
          }`
        );
      });
  });

const config = new Command();
config
  .name('config')
  .description('Get the path where the config is stored')
  .action(() => {
    console.log(conf.path);
  })
  .addCommand(
    new Command()
      .name('clear')
      .description('Wipes the config file')
      .action(() => {
        conf.clear();
      })
  );

const program = new Command();
program
  .name('xfin')
  .description('CLI to avoid the Xfinity website')
  .version('0.0.1')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password')
  .option('-s, --save', 'Save the username and password in plaintext')
  .addCommand(usage)
  .addCommand(config);

program.parse();
