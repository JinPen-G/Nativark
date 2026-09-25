import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSite } from '../SiteContext';
import { HomePage } from './HomePage';
import { HomeCTA, ProductSection, RentalSteps, SceneSection, ServiceBenefits, StoreSection, Testimonials } from '../components/HomeSections';
import { VideoHero } from '../components/v2/VideoHero';
import { DEFAULT_HOME_VERSION } from '../data/heroConfig';
import '../homeV2.css';

const HOME_VERSION_KEY = 'rental-os-home-version';

// 解析首页版本：URL ?home=1|2 优先并记忆，其次上次选择，最后默认版。
function resolveVersion(override: string | null): 1 | 2 {
  try {
    if (override === '1' || override === '2') {
      localStorage.setItem(HOME_VERSION_KEY, override);
      return Number(override) as 1 | 2;
    }
    const saved = localStorage.getItem(HOME_VERSION_KEY);
    if (saved === '1' || saved === '2') return Number(saved) as 1 | 2;
  } catch {
    /* localStorage 不可用时回退默认版 */
  }
  return DEFAULT_HOME_VERSION as 1 | 2;
}

export function HomePageV2() {
  const [params] = useSearchParams();
  const version = resolveVersion(params.get('home'));
  const { mode } = useSite();

  // 仅 2.0 首页给 <body> 挂标记：顶栏全透明融入视频（浅色文字）；
  // 滚过首屏到浅色产品区时切 v2-home-lighttop，让顶栏文字转深色保持可读。
  useEffect(() => {
    if (version !== 2) return;
    const body = document.body;
    body.classList.add('v2-home');
    let ticking = false;
    const update = () => {
      ticking = false;
      const product = document.querySelector('.v2-product');
      const overLight = product ? product.getBoundingClientRect().top <= 72 : false;
      body.classList.toggle('v2-home-lighttop', overLight);
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      body.classList.remove('v2-home', 'v2-home-lighttop');
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [version]);

  // 保留 1.0：?home=1 时原样渲染旧首页。
  if (version === 1) return <HomePage />;

  return (
    <div className="v2-home-root">
      <VideoHero />
      {/* 首屏预约 Hero 之后，进入正常内容区（复用 1.0 区块）：热门商品 → 场景 → 卖点 → 流程 → 门店 → 评价 → 品牌 CTA。 */}
      <div className="v2-product">
        <ProductSection mode={mode} />
        <SceneSection mode={mode} />
        <ServiceBenefits mode={mode} />
        <RentalSteps />
        <StoreSection />
        <Testimonials />
        <HomeCTA />
      </div>
    </div>
  );
}
