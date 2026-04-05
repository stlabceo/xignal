var exports = module.exports = {};
const db = require('./database/connect/config');

exports.DBCall = async function(sp, params){
    const connection = await db.getConnection(); // 커넥션 풀에서 개별 커넥션 가져오기
    // if(sp == 'CALL SP_U_USER_AUTO_EDIT(?)'){
    //     console.log('~~~~~~~~~');
    // }
    try{
        await connection.beginTransaction(); // 트랜잭션 시작

        // 프로시저 실행
        const reData = await connection.query(sp,params);

        await connection.commit(); // 실행 완료 후 COMMIT

        
        return reData[0][0];
    } catch (error) {
        console.log('~!!!!!!!!!!!!!!!!!!!');
        try{
            await connection.rollback(); // 에러 발생 시 ROLLBACK
        }catch(e){
        }

        console.error('Error:', error);
        return false;
    } finally {
        connection.release(); // 커넥션 반환
    }

    // const reData = await db.query(sp,params)
    //     .catch((err)=>{
    //         console.log(typeof(err) );

    //         if(typeof(err) == 'string'){
    //             if(err.includes('Duplicate')){
    //                 return false;
    //             }else{
    //                 console.log(sp + " error : " +err)        
    //             }
    //         }

    //         console.log(sp + " error : " +err)
    //         return false;
    //     });

    // try{
    //     return reData[0][0];
    // }catch(e){
    //     if(typeof(err) == 'string'){
    //         if(err.includes('Duplicate')){
    //             return false;
    //         }else{
    //             console.log("EEEEEE :::: " + e);    
    //         }
    //     }

    //     console.log("EEEEEE :::: " + e);
    //     return false;
    // }
};

exports.DBOriginCall = async function(sp, params){
    const reData = await db.query(sp,params)
        .catch((err)=>{
            console.log(sp + " error : " +err)
            return false;
        });
    
    try{
        return reData[0];
    }catch(e){
        console.log("EEEEEE :::: " + e);
        return false;
    }
};

exports.DBOneCall = async function(sp, params){
    const reData = await db.query(sp,params)
        .catch((err)=>{
            console.log(sp + " error : " +err)
            return false;
        });

    try{
        return reData[0][0][0];
    }catch(e){
        console.log("EEEEEE :::: " + e);
        return false;
    }
};

exports.DBPageCall = async function(sp, params){
    const reData = await db.query(sp,params)
        .catch((err)=>{
            console.log(sp + " error : " +err)
            return false;
        });

    try{
        return {item: reData[0][0], pageInfo: reData[0][1][0]};
    }catch(e){
        console.log("EEEEEE :::: " + e);
        return false;
    }
};
