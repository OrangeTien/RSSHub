import { Route } from '@/types';
import { load } from 'cheerio';
import logger from '@/utils/logger';
import puppeteer from '@/utils/puppeteer';

export const route: Route = {
    path: '/video/category/:type?',
    categories: ['multimedia'],
    example: '/91porny/video/category/latest',
    parameters: { type: '分类，可 /video/category/xxx 下找到分类名' },
    features: {
        requireConfig: false,
        requirePuppeteer: true,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '91porny',
    maintainers: ['OrangeTien'],
    handler,
    description: `| 最新合集 | 高清视频 | 最近加精 | 当前最热 | 本月最热 | 本月讨论 | 本月收藏 | 
| -------- | -------- | -------- | -------- | -------- | -------- | -------- |
| latest   | hd       | recent-favorite | hot-list | top-list | month-discuss | top-favorite |`,
};

async function handler(ctx) {
    const type = ctx.req.param('type') || 'latest';
    const baseUrl = 'https://91porny.com';
    const currentUrl = `${baseUrl}/video/category/${type}`;

    const browser = await puppeteer();
    const page = await browser.newPage();

    try {
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            request.resourceType() === 'document' ? request.continue() : request.abort();
        });

        logger.http(`Requesting ${currentUrl}`);
        await page.goto(currentUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });

        const response = await page.content();
        const $ = load(response);

        const postUrls = [];
        $('.colVideoList').each((_, element) => {
            const href = $(element).find('a').first().attr('href');
            if (href) {
                postUrls.push(baseUrl + href);
            }
        });

        // Process all posts in parallel
        const items = await Promise.all(
            postUrls.map(async (postUrl) => {
                const itemPage = await browser.newPage();
                try {
                    logger.http(`Requesting ${postUrl}`);
                    await itemPage.setRequestInterception(true);
                    itemPage.on('request', (request) => {
                        request.resourceType() === 'document' ? request.continue() : request.abort();
                    });

                    await itemPage.goto(postUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000,
                    });

                    const postContent = await itemPage.content();
                    const post$ = load(postContent);

                    const video_src = post$('#video-play').data('src');
                    const thumb_img = post$('#video-play').data('poster');
                    const title = post$('h4').text().trim();

                    const authorDiv = post$('.d-inline-block.ml-2.text-small').first();
                    const authorLink = authorDiv.find('a');
                    const authorUrl = baseUrl + authorLink.attr('href');
                    const authorName = authorLink.text().trim();

                    const publishDate = post$('.d-inline-block.ml-2.text-small').eq(1).text().trim();

                    return {
                        title,
                        link: postUrl,
                        description: `
                        <p>发布日期: ${publishDate}</p>
                        <p>作者: <a href="${authorUrl}">${authorName}</a></p>
                        <p>预览图:</p>
                        <img 
                            src="${thumb_img}" 
                            style="max-width: 100%; height: auto; display: block;" 
                            alt="预览图" 
                            referrerpolicy="no-referrer"
                        /></p>
                        <div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
                            <video 
                                controls 
                                style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
                                poster="${thumb_img}"
                                preload="metadata"
                            >
                                <source src="${video_src}" type="application/x-mpegURL">
                                您的浏览器不支持 HTML5 视频
                            </video>
                        </div>
                    `,
                    };
                } catch (error) {
                    logger.error(`Error processing ${postUrl}:`, error);
                    return null;
                } finally {
                    await itemPage.close();
                }
            })
        );

        // Filter out any failed items
        const validItems = items.filter((item) => item !== null);

        return {
            title: `91porny - ${type} 分类视频`,
            link: currentUrl,
            item: validItems,
        };
    } catch (error) {
        logger.error('Error during processing:', error);
        throw error;
    } finally {
        await browser.close();
    }
}
