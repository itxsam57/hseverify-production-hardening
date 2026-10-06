import { InquiryStaffPage } from "@/components/public-inquiry/inquiry-staff-page";
export const dynamic="force-dynamic";
export default async function ContactQueue({searchParams}:{searchParams:Promise<{page?:string|string[]}>}):Promise<React.JSX.Element>{
 const params=await searchParams;
 return InquiryStaffPage({role:"admin",page:typeof params.page==="string"?params.page:undefined});
}
