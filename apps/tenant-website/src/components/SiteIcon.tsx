import type { ComponentType, HTMLAttributes } from 'react';
import type { IconProps as AnimateIconProps } from '@animate-ui/react/icons';
import { ArrowRight as LArrowRight, ArrowUp as LArrowUp, ChevronRight as LChevronRight, ChevronDown as LChevronDown, Clock3, Menu as LMenu, X, Star as LStar, LoaderCircle, Info, CircleX, Shapes, type LucideIcon } from 'lucide-react';
import { useIconInteraction } from '../hooks/useIconInteraction';
import { Search as ASearch } from './animate-ui/icons/search';
import { SearchCheck as ASearchCheck } from './animate-ui/icons/search-check';
import { CalendarDays as ACalendarDays } from './animate-ui/icons/calendar-days';
import { MapPin as AMapPin } from './animate-ui/icons/map-pin';
import { Store as AStore } from './animate-ui/icons/store';
import { Globe as AGlobe } from './animate-ui/icons/globe';
import { Sun as ASun } from './animate-ui/icons/sun';
import { Moon as AMoon } from './animate-ui/icons/moon';
import { UserRound as AUserRound } from './animate-ui/icons/user-round';
import { Check as ACheck } from './animate-ui/icons/check';
import { CircleCheck as ACircleCheck } from './animate-ui/icons/circle-check';
import { ShieldCheck as AShieldCheck } from './animate-ui/icons/shield-check';
import { Truck as ATruck } from './animate-ui/icons/truck';
import { Headset as AHeadset } from './animate-ui/icons/headset';
import { Plus as APlus } from './animate-ui/icons/plus';
import { Trash2 as ATrash2 } from './animate-ui/icons/trash-2';
import { PackageOpen as APackageOpen } from './animate-ui/icons/package-open';
import { ReceiptText as AReceiptText } from './animate-ui/icons/receipt-text';
import { ClipboardList as AClipboardList } from './animate-ui/icons/clipboard-list';
import { MapPinned as AMapPinned } from './animate-ui/icons/map-pinned';
import { TicketPercent as ATicketPercent } from './animate-ui/icons/ticket-percent';
import { Bell as ABell } from './animate-ui/icons/bell';
import { LogOut as ALogOut } from './animate-ui/icons/log-out';
import { LockKeyhole as ALockKeyhole } from './animate-ui/icons/lock-keyhole';
import { FileText as AFileText } from './animate-ui/icons/file-text';
import { BookOpen as ABookOpen } from './animate-ui/icons/book-open';
import { CreditCard as ACreditCard } from './animate-ui/icons/credit-card';
import { Camera as ACamera } from './animate-ui/icons/camera';
import { Tent as ATent } from './animate-ui/icons/tent';
import { CarFront as ACarFront } from './animate-ui/icons/car-front';
import { Laptop as ALaptop } from './animate-ui/icons/laptop';
import { Wrench as AWrench } from './animate-ui/icons/wrench';
import { Armchair as AArmchair } from './animate-ui/icons/armchair';
import { Baby as ABaby } from './animate-ui/icons/baby';
import { Bike as ABike } from './animate-ui/icons/bike';
import { HeartHandshake as AHeartHandshake } from './animate-ui/icons/heart-handshake';
import { Eye as AEye } from './animate-ui/icons/eye';
import { EyeOff as AEyeOff } from './animate-ui/icons/eye-off';
import { ClipboardCheck as AClipboardCheck } from './animate-ui/icons/clipboard-check';
import { ExternalLink as AExternalLink } from './animate-ui/icons/external-link';

// The shared wrapper keeps the optical grid and follows the existing control.
// Separators, ratings and status information remain still; business state lives outside icons.
type IconProps = HTMLAttributes<HTMLSpanElement>;
type AnimatedGlyph = ComponentType<AnimateIconProps<'default'>>;
function animatedIcon(Glyph: AnimatedGlyph, name: string) {
  return function SiteIcon({ className = '', ...props }: IconProps) {
    const { ref, active } = useIconInteraction();
    return <span ref={ref} {...props} aria-hidden="true" data-icon={name} className={'site-icon anticon ' + className}>
      <Glyph size={20} strokeWidth={1.75} aria-hidden="true" focusable="false" animate={active} />
    </span>;
  };
}
function icon(Glyph: LucideIcon, rotating = false) {
  return function StaticSiteIcon({ className = '', ...props }: IconProps) {
    return <span {...props} aria-hidden="true" className={'site-icon anticon' + (rotating ? ' site-icon-spinning' : '') + ' ' + className}>
      <Glyph size="1em" strokeWidth={1.75} aria-hidden="true" focusable="false" />
    </span>;
  };
}
export const Search = animatedIcon(ASearch, 'search');
export const SearchCheck = animatedIcon(ASearchCheck, 'search-check');
export const Calendar = animatedIcon(ACalendarDays, 'calendar-days');
export const MapPin = animatedIcon(AMapPin, 'map-pin');
export const Store = animatedIcon(AStore, 'store');
export const Globe = animatedIcon(AGlobe, 'globe');
export const Sun = animatedIcon(ASun, 'sun');
export const Moon = animatedIcon(AMoon, 'moon');
export const User = animatedIcon(AUserRound, 'user-round');
export const Check = animatedIcon(ACheck, 'check');
export const CheckCircle = animatedIcon(ACircleCheck, 'circle-check');
export const ShieldCheck = animatedIcon(AShieldCheck, 'shield-check');
export const Truck = animatedIcon(ATruck, 'truck');
export const Headphones = animatedIcon(AHeadset, 'headset');
export const Plus = animatedIcon(APlus, 'plus');
export const Trash = animatedIcon(ATrash2, 'trash-2');
export const Package = animatedIcon(APackageOpen, 'package-open');
export const Receipt = animatedIcon(AReceiptText, 'receipt-text');
export const Clipboard = animatedIcon(AClipboardList, 'clipboard-list');
export const Address = animatedIcon(AMapPinned, 'map-pinned');
export const Ticket = animatedIcon(ATicketPercent, 'ticket-percent');
export const Bell = animatedIcon(ABell, 'bell');
export const LogOut = animatedIcon(ALogOut, 'log-out');
export const Lock = animatedIcon(ALockKeyhole, 'lock-keyhole');
export const Document = animatedIcon(AFileText, 'file-text');
export const Guide = animatedIcon(ABookOpen, 'book-open');
export const Payment = animatedIcon(ACreditCard, 'credit-card');
export const Handshake = animatedIcon(AHeartHandshake, 'heart-handshake');
export const Eye = animatedIcon(AEye, 'eye');
export const EyeOff = animatedIcon(AEyeOff, 'eye-off');
export const ClipboardCheck = animatedIcon(AClipboardCheck, 'clipboard-check');
export const ExternalLink = animatedIcon(AExternalLink, 'external-link');

export const ArrowRight = icon(LArrowRight);
export const ArrowUp = icon(LArrowUp);
export const ChevronRight = icon(LChevronRight);
export const ChevronDown = icon(LChevronDown);
export const Clock = icon(Clock3);
export const Menu = icon(LMenu);
export const Close = icon(X);
export const Star = icon(LStar);
export const Loader = icon(LoaderCircle, true);
export const InfoCircle = icon(Info);
export const CloseCircle = icon(CircleX);
const categoryGlyphs: Record<string, ReturnType<typeof animatedIcon>> = {
  camera: animatedIcon(ACamera, 'camera'), camping: animatedIcon(ATent, 'tent'),
  car: animatedIcon(ACarFront, 'car-front'), laptop: animatedIcon(ALaptop, 'laptop'),
  tool: animatedIcon(AWrench, 'wrench'), home: animatedIcon(AArmchair, 'armchair'),
  baby: animatedIcon(ABaby, 'baby'), sports: animatedIcon(ABike, 'bike'),
};
const OtherCategory = icon(Shapes);
export function CategoryIcon({ name }: { name: string }) {
  const Glyph = categoryGlyphs[name] || OtherCategory;
  return <Glyph className="category-icon" />;
}
