// Effective dose rate (ICRP116, uSv/h) grid at a fixed altitude, averaged over the daily W-index of a year.
// usage: grid <year> <alt_km> <g> <dlat> <dlon> [mode]   mode: "mean" = average dose over 12 monthly-mean W (default), "test" = one point diagnostics
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <cmath>
#include <cstdlib>
using namespace std;
double getHPcpp(int,int,int); double getrcpp(double,double); double getdcpp(double,double);
double getSpecCpp(int,double,double,double,double,double); double get511fluxCpp(double,double,double);
const int nebin=140, npart=33, ie511=78;
double emid[nebin+1], ewid[nebin+1], dcc[npart+1][nebin+1];
double dose(double s,double r,double d,double g){
  double t=0;
  for(int ie=1;ie<=nebin;ie++) for(int ip=0;ip<=npart;ip++){
    double f=getSpecCpp(ip,s,r,d,emid[ie],g);
    if(ip==npart&&ie==ie511) f+=get511fluxCpp(s,r,d)/ewid[ie];
    t+=f*dcc[ip][ie]*ewid[ie];
  }
  return t*1.0e-6*3600; // pSv/s -> uSv/h
}
int main(int argc,char**argv){
  int year=atoi(argv[1]); double alt=atof(argv[2]), g=atof(argv[3]), dlat=atof(argv[4]), dlon=atof(argv[5]);
  string mode=argc>6?argv[6]:"mean";
  ifstream dccf("dcc/ICRP116.inp"); string str; getline(dccf,str); getline(dccf,str);
  for(int ie=1;ie<=nebin;ie++){getline(dccf,str); istringstream l(str); l>>emid[ie]>>ewid[ie]; for(int ip=0;ip<=npart;ip++) l>>dcc[ip][ie];}
  int mdays[13]={0,31,28,31,30,31,30,31,31,30,31,30,31}; if(year%4==0) mdays[2]=29;
  double W[13]; double wsum=0; int nd=0;
  for(int m=1;m<=12;m++){double s=0; for(int d=1;d<=mdays[m];d++) s+=getHPcpp(year,m,d); W[m]=s/mdays[m]; wsum+=s; nd+=mdays[m];}
  double Wyear=wsum/nd;
  cerr<<"year "<<year<<" mean W "<<Wyear<<" monthly:"; for(int m=1;m<=12;m++) cerr<<" "<<W[m]; cerr<<"\n";
  if(mode=="test"){
    double lat=atof(argv[7]), lon=atof(argv[8]); double r=getrcpp(lat,lon), d=getdcpp(alt,lat);
    double mean=0; for(int m=1;m<=12;m++) mean+=dose(W[m],r,d,g)/12;
    cout<<"lat "<<lat<<" lon "<<lon<<" Rc "<<r<<" depth "<<d<<" dose(mean of monthly W) "<<mean<<" dose(annual W) "<<dose(Wyear,r,d,g)<<"\n"; return 0;
  }
  cout<<"# year "<<year<<" alt_km "<<alt<<" g "<<g<<" meanW "<<Wyear<<"\n";
  for(double lat=-90;lat<=90+1e-9;lat+=dlat){
    double d=getdcpp(alt,lat);
    for(double lon=-180;lon<180-1e-9;lon+=dlon){
      double r=getrcpp(lat,lon); double mean=0; for(int m=1;m<=12;m++) mean+=dose(W[m],r,d,g)/12;
      cout<<lat<<" "<<lon<<" "<<r<<" "<<mean<<"\n";
    }
  }
}
